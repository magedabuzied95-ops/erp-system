import crypto from "node:crypto";

import db from "../database/db.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { emitToRooms } from "../utils/socket.js";
import {
  appendAiGeneratedSupportReply,
  ensureAiSupportLogSchema,
  getAiSupportConversationState,
  markAiSupportConversationEscalated,
} from "./aiSupportLogService.js";
import {
  AI_AGENT_CHANNELS,
  extractMetaWebhookMessages,
  getChannelSettings,
  linkChannelConversationToCustomerProfile,
  logChannelEvent,
  normalizeOutgoingChannelReply,
  upsertChannelConversationMapping,
  verifyMetaWebhookSignature,
} from "./aiChannelAdapterService.js";
import { pushAIEvent } from "./aiEventLogger.js";
import { isDuplicateMessage } from "./aiMessageDeduplication.js";
import {
  normalizeProductCards,
  productCardReplyText,
  resolvePublicProductImageUrl,
} from "./aiProductCards.js";
import { understandProductImageForSearch } from "./openaiSupportService.js";
import {
  createAiOrderDraft,
  searchAiOrderProducts,
} from "./aiAgentOrderService.js";
import { searchIndexedProductImageMatches } from "./aiVisualProductImageIndexService.js";
import { getConversationMemory, updateConversationMemory } from "./aiConversationMemory.js";
import { extractShoeSize } from "./aiMessageExtractors.js";
import { getAiAgentSettings } from "./aiSalesAgentService.js";
import { evaluateProductDecisionGate } from "./aiProductDecisionGate.js";
import {
  buildSizeAvailabilityStorefrontUrl,
  detectSizeAvailabilityIntent,
  resolvePendingSizeBrowseQuality,
  sizeAvailabilityClarificationText,
  sizeAvailabilityReplyText,
} from "./aiSizeAvailabilityLinkService.js";
import { resolveProductCardLinks } from "./storefrontProductUrlService.js";

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;
const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_messaging",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_content_publish",
];
const META_WEBHOOK_SUBSCRIBED_FIELDS = [
  "messages",
  "messaging_postbacks",
  "messaging_optins",
  "messaging_referrals",
  "message_deliveries",
  "message_reads",
  "message_echoes",
];
const META_WEBHOOK_MINIMAL_FIELDS = [
  "messages",
  "messaging_postbacks",
];
const META_WEBHOOK_REQUIRED_FIELDS = META_WEBHOOK_MINIMAL_FIELDS;
const META_FULLY_CONNECTED_STATUS = "fully_connected";

const text = (value = "") => String(value ?? "").trim();
const bool = (value) => value === true || value === "true" || value === 1 || value === "1";
const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
};
const json = (value) => JSON.stringify(value === undefined ? null : value);
const nowIso = () => new Date().toISOString();
const minutesFromNow = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();
const META_COMMERCE_ACTIONS = ["المقاسات", "صور أكتر", "متاح كاش/فيزا؟", "اطلب الآن", "بدائل", "موظف"];
const META_COMMERCE_ACTION_FALLBACK = "اكتب: المقاسات / صور أكتر / اطلب الآن / بدائل / موظف";
const ORDER_DRAFT_REPLY = "تمام، جهزتلك الطلب. ابعتلي الاسم ورقم الموبايل والعنوان للتأكيد.";
const CHECKOUT_INFO_REPLY = "ابعتلي الاسم ورقم الموبايل والعنوان عشان أجهز الطلب.";
const HUMAN_HANDOFF_REPLY = "تمام، هحوّلك لحد من الفريق يساعدك حالًا.";
const MORE_IMAGES_EMPTY_REPLY = "مفيش صور ألوان أكتر واضحة عندي دلوقتي، تحب تبعتلي صورة للموديل؟";
const VISUAL_NO_STRONG_MATCH_REPLY = "مش لاقي نفس الموديل بالظبط\nبس دي أقرب موديلات شبهه.";
const HOT_LEAD_INSIGHT = "عميل قريب جدًا من الشراء";
const CHECKOUT_INFO_COLLECTION_REPLY = "\u062a\u0645\u0627\u0645  \u0647\u062c\u0647\u0632\u0644\u0643 \u0627\u0644\u0637\u0644\u0628.\n\u0627\u0628\u0639\u062a\u0644\u064a \u0627\u0644\u0627\u0633\u0645 \u0648\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0628\u0627\u064a\u0644 \u0648\u0627\u0644\u0639\u0646\u0648\u0627\u0646.";
const VISUAL_CLARIFICATION_REPLY = "\u0645\u0634 \u0642\u0627\u062f\u0631 \u0623\u062d\u062f\u062f \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0628\u062f\u0642\u0629 \u0645\u0646 \u0627\u0644\u0635\u0648\u0631\u0629 \u062f\u064a.\n\u0645\u0645\u0643\u0646 \u062a\u0628\u0639\u062a \u0635\u0648\u0631\u0629 \u0623\u0648\u0636\u062d \u0645\u0646 \u0627\u0644\u062c\u0646\u0628 \u0623\u0648 \u0627\u0633\u0645 \u0627\u0644\u0645\u0648\u062f\u064a\u0644\u061f";
const VISUAL_CLOSE_MATCH_REPLY = "\u0645\u0634 \u0646\u0641\u0633 \u0627\u0644\u0645\u0648\u062f\u064a\u0644 \u0628\u0627\u0644\u0638\u0628\u0637\u060c \u0628\u0633 \u062f\u064a \u0623\u0642\u0631\u0628 \u062d\u0627\u062c\u0629 \u0634\u0628\u0647\u0647 \u0639\u0646\u062f\u0646\u0627.";
const MULTIPLE_PRODUCT_CLARIFICATION_REPLY = "\u0623\u0646\u0647\u064a \u0648\u0627\u062d\u062f \u0641\u064a\u0647\u0645\u061f \u0627\u0644\u0623\u0648\u0644 \u0648\u0644\u0627 \u0627\u0644\u062a\u0627\u0646\u064a\u061f";
const LOW_STOCK_THRESHOLD = 2;
const HOT_LEAD_THRESHOLD = 65;
const MAX_VISUAL_IMAGE_BYTES = 8 * 1024 * 1024;
const VISUAL_IMAGE_TIMEOUT_MS = 12000;

const hasTerm = (message = "", terms = []) => {
  const normalized = text(message).toLowerCase();
  return terms.find((term) => normalized.includes(String(term).toLowerCase())) || "";
};

const hasAnyArabicCommerceTerm = (message = "", terms = []) => hasTerm(message, terms);

const detectHumanHandoff = (message = "") =>
  hasTerm(message, ["موظف", "خدمة عملاء", "حد يكلمني", "مش فاهم", "كلموني"]);

const detectMoreImagesRequest = (message = "") =>
  hasAnyArabicCommerceTerm(message, ["\u0635\u0648\u0631 \u0623\u0643\u062a\u0631", "\u0635\u0648\u0631 \u0627\u0643\u062a\u0631", "\u0635\u0648\u0631\u0629 \u062a\u0627\u0646\u064a\u0629", "\u0635\u0648\u0631 \u062a\u0627\u0646\u064a\u0629", "\u0648\u0631\u064a\u0646\u064a \u0623\u0644\u0648\u0627\u0646", "\u0648\u0631\u064a\u0646\u064a \u0627\u0644\u0648\u0627\u0646", "more photos", "more images"]) ||
  hasTerm(message, ["صور أكتر", "صور اكتر", "صورة تانية", "وريني ألوان", "وريني الوان", "ألوانه ايه", "الوانه ايه"]);

const detectSizesRequest = (message = "") =>
  hasAnyArabicCommerceTerm(message, ["\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a", "\u0645\u0642\u0627\u0633\u0627\u062a", "\u0641\u064a\u0647 \u0645\u0642\u0627\u0633", "\u0645\u062a\u0627\u062d \u0645\u0642\u0627\u0633", "\u0645\u0642\u0627\u0633\u0627\u062a\u0647", "sizes", "size"]) ||
  hasTerm(message, ["المقاسات", "مقاسات", "فيه مقاس", "متاح مقاس", "مقاساته"]);

const detectExplicitCheckoutIntent = (message = "") =>
  Boolean(hasAnyArabicCommerceTerm(message, [
    "\u0639\u0627\u064a\u0632\u0647",
    "\u0639\u0627\u064a\u0632\u0629",
    "\u0639\u0627\u064a\u0632\u0647\u0627",
    "\u0627\u0637\u0644\u0628\u0647",
    "\u0627\u0637\u0644\u0628\u0647\u0627",
    "\u0627\u0637\u0644\u0628",
    "\u0627\u062d\u062c\u0632\u0647",
    "\u0627\u062d\u062c\u0632\u0647\u0627",
    "\u0627\u062d\u062c\u0632",
    "\u0647\u0634\u062a\u0631\u064a\u0647",
    "\u0647\u0634\u062a\u0631\u064a\u0647\u0627",
    "\u0647\u0627\u062e\u062f\u0647",
    "\u0647\u0627\u062e\u062f\u0647\u0627",
    "\u062a\u0645\u0627\u0645",
    "buy",
    "order",
    "reserve",
  ]));

const detectBuyingIntent = (message = "") =>
  detectExplicitCheckoutIntent(message);

const detectShippingQuestion = (message = "") =>
  hasTerm(message, ["توصيل", "شحن", "الشحن", "التوصيل"]);

const detectProductDetailQuestion = (message = "") =>
  Boolean(
    detectMoreImagesRequest(message) ||
      detectSizesRequest(message) ||
      extractShoeSize(message) ||
      hasAnyArabicCommerceTerm(message, [
        "\u0627\u0644\u0644\u0648\u0646 \u062f\u0647",
        "\u0641\u064a\u0647",
        "\u0645\u062a\u0648\u0641\u0631",
        "\u0623\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629",
        "\u0627\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629",
      ])
  );

const checkoutStageRank = (stage = "") => ({
  browsing: 0,
  product_selected: 1,
  product_details: 2,
  buying_intent: 3,
  checkout: 4,
  selecting_size: 2,
  size_selected: 2,
  awaiting_booking_confirmation: 3,
  collecting_contact: 4,
  awaiting_checkout_info: 4,
  checkout_confirmed: 5,
  handoff: 6,
}[text(stage)] ?? 0);

const checkoutStageAtLeast = (stage = "", minimum = "browsing") =>
  checkoutStageRank(stage) >= checkoutStageRank(minimum);

const detectCheckoutConfirmation = (message = "") =>
  Boolean(hasTerm(message, [
    "\u062a\u0645\u0627\u0645",
    "\u0645\u0627\u0634\u064a",
    "\u0623\u064a\u0648\u0647",
    "\u0627\u064a\u0648\u0647",
    "\u0627\u0647",
    "\u0647\u0627\u062e\u062f\u0647",
    "\u0647\u0627\u062e\u062f\u0647\u0627",
    "\u0647\u0627\u062a\u0647",
    "\u0647\u0627\u062a\u0647\u0627",
    "\u0627\u062d\u062c\u0632",
    "\u0627\u062d\u062c\u0632\u0647",
    "\u0627\u062d\u062c\u0632\u0647\u0627",
    "\u0627\u062d\u062c\u0632\u0647\u0648\u0644\u064a",
    "\u0627\u0637\u0644\u0628",
    "\u0627\u0637\u0644\u0628\u0647",
    "\u0627\u0637\u0644\u0628\u0647\u0627",
    "ok",
    "yes",
  ]));

const detectExplicitSizeChange = (message = "") => {
  const size = extractShoeSize(message);
  if (!size) return false;
  return Boolean(hasTerm(message, [
    "\u0644\u0627",
    "\u062e\u0644\u064a\u0647\u0627",
    "\u062e\u0644\u064a\u0647",
    "\u0637\u0628",
    "\u0628\u062f\u0644",
    "\u063a\u064a\u0631",
    "\u0645\u0634",
    "change",
    "instead",
  ]));
};

const bookingConfirmationPrompt = (size = "") =>
  `\u0645\u0642\u0627\u0633 ${text(size)} \u0645\u062a\u0627\u062d \u0645\u0639\u0627\u064a\u0627  \u062a\u062d\u0628 \u0623\u062d\u062c\u0632\u0647\u0648\u0644\u0643\u061f`;

const repeatedBookingConfirmationPrompt = () =>
  "\u062a\u0645\u0627\u0645\u060c \u0623\u062d\u062c\u0632\u0647\u0648\u0644\u0643\u061f";

const sizeDigits = (value = "") =>
  text(value)
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[^\d]/g, "");

const isOnlyShoeSizeMessage = (message = "", size = "") => {
  const messageDigits = sizeDigits(message);
  const selectedDigits = sizeDigits(size);
  if (!messageDigits || !selectedDigits || messageDigits !== selectedDigits) return false;
  return !text(message).replace(/[\d\u0660-\u0669\u06f0-\u06f9\s.,،:;!؟?()-]/g, "");
};

export const evaluateMetaCheckoutContinuation = ({ memory = {}, messageText = "" } = {}) => {
  const previousCheckoutStage = text(memory.checkoutStage || "browsing");
  const selectedSize = text(memory.selectedSize || "");
  const selectedProductId = memory.selectedProductId || memory.lastProductCard?.product_id || null;
  const bookingConfirmationAsked = memory.bookingConfirmationAsked === true;
  const requestedSize = extractShoeSize(messageText) || "";
  const sameSizeRepeated = Boolean(
    requestedSize &&
    selectedSize &&
    sizeDigits(requestedSize) === sizeDigits(selectedSize) &&
    isOnlyShoeSizeMessage(messageText, requestedSize)
  );
  const confirmationDetected = detectExplicitCheckoutIntent(messageText);
  const explicitSizeChange = detectExplicitSizeChange(messageText);
  const eligible = Boolean(
    selectedProductId &&
    selectedSize &&
    checkoutStageAtLeast(previousCheckoutStage, "product_details") &&
    !checkoutStageAtLeast(previousCheckoutStage, "checkout") &&
    !explicitSizeChange
  );

  if (!eligible) {
    return {
      handled: false,
      branch: "not_checkout_continuation",
      previousCheckoutStage,
      requestedSize,
      selectedSize,
      bookingConfirmationAsked,
      confirmationDetected,
      explicitSizeChange,
    };
  }

  if (confirmationDetected || (sameSizeRepeated && bookingConfirmationAsked)) {
    return {
      handled: true,
      branch: sameSizeRepeated && bookingConfirmationAsked ? "repeated_size_treated_as_confirmation" : "booking_confirmation_to_checkout_info",
      previousCheckoutStage,
      nextCheckoutStage: "checkout",
      selectedProductId,
      selectedSize,
      bookingConfirmationAsked: true,
      confirmationDetected,
      repeatedSameSize: sameSizeRepeated,
      replyText: CHECKOUT_INFO_COLLECTION_REPLY,
      skipGenericSizeFlowReason: "checkout_continuation_has_selected_size",
    };
  }

  if (sameSizeRepeated) {
    return {
      handled: true,
      branch: "repeat_same_size_booking_prompt",
      previousCheckoutStage,
      nextCheckoutStage: "buying_intent",
      selectedProductId,
      selectedSize,
      bookingConfirmationAsked: true,
      confirmationDetected: false,
      repeatedSameSize: true,
      replyText: bookingConfirmationPrompt(selectedSize),
      skipGenericSizeFlowReason: "same_selected_size_repeated",
    };
  }

  return {
    handled: false,
    branch: "waiting_for_booking_confirmation",
    previousCheckoutStage,
    selectedProductId,
    selectedSize,
    bookingConfirmationAsked,
    confirmationDetected: false,
    repeatedSameSize: false,
  };
};

const imageAttachments = (attachments = []) =>
  (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => {
      const type = text(attachment?.type).toLowerCase();
      const url = text(attachment?.url || attachment?.image_url || attachment?.imageUrl);
      return url && (type.includes("image") || /\.(png|jpe?g|webp)(?:[?#].*)?$/i.test(url));
    })
    .slice(0, 1);

const detectFaqIntent = (message = "") => {
  const normalized = text(message).toLowerCase();
  if (hasTerm(normalized, ["كاش", "فيزا", "دفع عند الاستلام", "الدفع عند الاستلام", "cod"])) return "payment";
  if (hasTerm(normalized, ["توصيل كام", "الشحن كام", "شحن كام", "التوصيل كام", "تكلفة الشحن"])) return "delivery";
  if (hasTerm(normalized, ["بيرجع", "استبدال", "استرجاع", "ينفع ارجع", "ينفع أرجع"])) return "exchange";
  return "";
};

const readableArabicSetting = (value = "") => {
  const safe = text(value);
  return /[\u0600-\u06FF]/.test(safe) ? safe : "";
};

const imageIdentity = (url = "") =>
  text(url)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/g, "");

const emitAiInboxEvent = (tenantId, event, payload = {}) => {
  emitToRooms([`tenant:${tenantId}`, `ai-support:${tenantId}`], event, {
    tenantId,
    ...payload,
  });
};

const secretKey = () =>
  crypto.createHash("sha256").update(text(process.env.SECRET_ENCRYPTION_KEY || process.env.JWT_SECRET || "SECRET_KEY")).digest();

const encryptSecret = (value = "") => {
  const plain = text(value);
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
};

const decryptSecret = (value = "") => {
  const raw = text(value);
  if (!raw) return "";
  if (!raw.startsWith("enc:v1:")) return raw;
  const [, , ivRaw, tagRaw, encryptedRaw] = raw.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
};

const tryDecryptSecret = (value = "", metadata = {}) => {
  try {
    return { value: decryptSecret(value), error: null };
  } catch (error) {
    console.error("[meta-inbox] meta_token_decrypt_failed", {
      tenant_id: metadata.tenant_id || null,
      config_id: metadata.config_id || null,
      source: metadata.source || "",
      channel: metadata.channel || "",
      message: error?.message || "Meta token decrypt failed",
      code: error?.code || "",
    });
    return { value: "", error };
  }
};

const parseMetaPayload = async (response) => {
  const body = await response.text();
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
};

const metaErrorMessage = (payload = {}, fallback = "Meta Graph API request failed") =>
  payload?.error?.message || payload?.message || fallback;

const callMetaGet = async ({ endpoint, token, params = {} }) => {
  const target = new URL(`${GRAPH_BASE_URL}${endpoint}`);
  Object.entries(params || {}).forEach(([key, value]) => {
    const safe = text(value);
    if (safe) target.searchParams.set(key, safe);
  });
  if (text(token)) target.searchParams.set("access_token", token);
  const response = await fetch(target);
  const payload = await parseMetaPayload(response);
  if (!response.ok) {
    throw Object.assign(new Error(metaErrorMessage(payload)), {
      status: response.status,
      meta: payload?.error || payload,
    });
  }
  return payload;
};

const callMetaPost = async ({ endpoint, token, body = {} }) => {
  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json(body),
  });
  const payload = await parseMetaPayload(response);
  if (!response.ok) {
    throw Object.assign(new Error(metaErrorMessage(payload)), {
      status: response.status,
      meta: payload?.error || payload,
    });
  }
  return payload;
};

const callMetaPostForm = async ({ endpoint, token, body = {} }) => {
  const form = new URLSearchParams();
  Object.entries(body || {}).forEach(([key, value]) => {
    const safe = text(value);
    if (safe) form.set(key, safe);
  });
  form.set("access_token", token);
  const response = await fetch(`${GRAPH_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const payload = await parseMetaPayload(response);
  if (!response.ok) {
    throw Object.assign(new Error(metaErrorMessage(payload)), {
      status: response.status,
      meta: payload?.error || payload,
    });
  }
  return payload;
};

const maskSecret = (value = "") => {
  const safe = text(value);
  if (!safe) return "";
  if (safe.length <= 8) return "****";
  return `${safe.slice(0, 4)}...${safe.slice(-4)}`;
};

const maskIdForLog = (value = "") => {
  const safe = text(value);
  if (!safe) return "";
  if (safe.length <= 6) return "***";
  return `${safe.slice(0, 3)}...${safe.slice(-3)}`;
};

const sanitizeConfig = (row = {}) => ({
  id: row.id || null,
  tenant_id: Number(row.tenant_id),
  facebook_page_id: row.facebook_page_id || "",
  facebook_page_name: row.facebook_page_name || row.page_name || "",
  page_name: row.facebook_page_name || row.page_name || "",
  page_access_token_configured: Boolean(row.page_access_token_encrypted),
  page_access_token_masked: row.page_access_token_encrypted ? maskSecret(decryptSecret(row.page_access_token_encrypted)) : "",
  instagram_business_account_id: row.instagram_business_account_id || "",
  instagram_username: row.instagram_username || "",
  app_id: row.app_id || "",
  app_secret_configured: Boolean(row.app_secret_encrypted),
  app_secret_masked: row.app_secret_encrypted ? maskSecret(decryptSecret(row.app_secret_encrypted)) : "",
  verify_token_configured: Boolean(row.verify_token),
  verify_token_masked: row.verify_token ? maskSecret(row.verify_token) : "",
  webhook_enabled: row.webhook_enabled === true,
  webhook_verified: row.webhook_verified === true || row.capability_status?.webhook?.subscribed_apps?.webhook_verified === true,
  subscribed_apps_verified: row.subscribed_apps_verified === true || row.capability_status?.webhook?.subscribed_apps?.subscribed_apps_verified === true,
  permissions_saved: row.permissions_saved === true || row.capability_status?.permissions?.ok === true,
  messenger_enabled: row.messenger_enabled === true,
  instagram_dm_enabled: row.instagram_dm_enabled === true || row.instagram_enabled === true,
  instagram_enabled: row.instagram_dm_enabled === true || row.instagram_enabled === true,
  facebook_publishing_enabled: row.facebook_publishing_enabled === true,
  instagram_publishing_enabled: row.instagram_publishing_enabled === true,
  last_sync_at: row.last_sync_at || null,
  token_expires_at: row.token_expires_at || null,
  token_status: row.token_status || row.token_health_status || row.status || "not_connected",
  token_health_status: row.token_health_status || row.token_status || row.status || "not_connected",
  token_last_validated_at: row.token_last_validated_at || null,
  auto_refresh_enabled: row.auto_refresh_enabled === true,
  last_auto_refresh_at: row.last_auto_refresh_at || null,
  next_refresh_check_at: row.next_refresh_check_at || null,
  capability_status: row.capability_status && typeof row.capability_status === "object" ? row.capability_status : {},
  status: row.status || "not_connected",
});

const parseMetaDate = (value = null) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const safe = text(value);
  if (!safe) return null;
  const direct = new Date(safe);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = safe.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!match) return null;
  const [, first, second, year, hour = "0", minute = "0", secondPart = "0", meridiem = ""] = match;
  const month = Number(first);
  const day = Number(second);
  let hours = Number(hour);
  if (/pm/i.test(meridiem) && hours < 12) hours += 12;
  if (/am/i.test(meridiem) && hours === 12) hours = 0;
  const parsed = new Date(Number(year), month - 1, day, hours, Number(minute), Number(secondPart));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const channelAlias = (channel = "") => (channel === AI_AGENT_CHANNELS.INSTAGRAM ? "instagram" : "facebook");
const adapterChannel = (channel = "") => (channel === "instagram" ? AI_AGENT_CHANNELS.INSTAGRAM : AI_AGENT_CHANNELS.FACEBOOK_MESSENGER);

let schemaReadyPromise = null;

export const ensureMetaIntegrationSchema = async (clientOrPool = db) => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS meta_integration_configs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          facebook_page_id TEXT NOT NULL DEFAULT '',
          page_name TEXT NOT NULL DEFAULT '',
          facebook_page_name TEXT NOT NULL DEFAULT '',
          page_access_token_encrypted TEXT NOT NULL DEFAULT '',
          instagram_business_account_id TEXT NOT NULL DEFAULT '',
          instagram_username TEXT NOT NULL DEFAULT '',
          app_id TEXT NOT NULL DEFAULT '',
          app_secret_encrypted TEXT NOT NULL DEFAULT '',
          verify_token TEXT NOT NULL DEFAULT '',
          webhook_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          webhook_verified BOOLEAN NOT NULL DEFAULT FALSE,
          subscribed_apps_verified BOOLEAN NOT NULL DEFAULT FALSE,
          permissions_saved BOOLEAN NOT NULL DEFAULT FALSE,
          messenger_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          instagram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          instagram_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          facebook_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          instagram_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE,
          capability_status JSONB NOT NULL DEFAULT '{}'::jsonb,
          token_expires_at TIMESTAMP NULL,
          last_sync_at TIMESTAMP NULL,
          status TEXT NOT NULL DEFAULT 'not_connected',
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id)
        )
      `);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS facebook_page_name TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS instagram_username TEXT NOT NULL DEFAULT ''`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS webhook_verified BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS subscribed_apps_verified BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS permissions_saved BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS instagram_dm_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS facebook_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS instagram_publishing_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS capability_status JSONB NOT NULL DEFAULT '{}'::jsonb`);
      await clientOrPool.query(`ALTER TABLE IF EXISTS meta_integration_configs ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP NULL`);
      await clientOrPool.query(`UPDATE meta_integration_configs SET facebook_page_name = page_name WHERE facebook_page_name = '' AND page_name <> ''`);
      await clientOrPool.query(`UPDATE meta_integration_configs SET instagram_dm_enabled = instagram_enabled WHERE instagram_dm_enabled = FALSE AND instagram_enabled = TRUE`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_meta_integration_page ON meta_integration_configs (facebook_page_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_meta_integration_ig ON meta_integration_configs (instagram_business_account_id)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_meta_integration_verify ON meta_integration_configs (verify_token)`);
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS meta_oauth_states (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          user_id BIGINT NULL,
          state_token TEXT NOT NULL UNIQUE,
          long_lived_user_token_encrypted TEXT NOT NULL DEFAULT '',
          pending_pages JSONB NOT NULL DEFAULT '[]'::jsonb,
          selected_page_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'started',
          error_message TEXT NOT NULL DEFAULT '',
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_tenant_user_created ON meta_oauth_states (tenant_id, user_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_meta_oauth_states_state ON meta_oauth_states (state_token)`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
};

export const getMetaIntegrationConfig = async ({ tenantId } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const activeStatusSql = `('fully_connected','active','connected','saved')`;
  const [integrationResult, marketingResult] = await Promise.all([
    db.query(
      `
      SELECT *
      FROM meta_integration_configs
      WHERE tenant_id = $1
      ORDER BY
        CASE WHEN page_access_token_encrypted <> '' THEN 0 ELSE 1 END,
        CASE WHEN COALESCE(token_expires_at, NOW() + INTERVAL '1 day') > NOW() THEN 0 ELSE 1 END,
        CASE WHEN LOWER(COALESCE(status, '')) IN ${activeStatusSql} THEN 0 ELSE 1 END,
        CASE WHEN webhook_enabled = TRUE OR webhook_verified = TRUE OR subscribed_apps_verified = TRUE THEN 0 ELSE 1 END,
        updated_at DESC
      LIMIT 1
      `,
      [scopedTenantId]
    ),
    db.query(`SELECT * FROM marketing_settings WHERE tenant_id = $1 LIMIT 1`, [scopedTenantId]).catch(() => ({ rows: [] })),
  ]);
  const integration = integrationResult.rows[0] || {};
  const marketing = marketingResult.rows[0] || null;
  if (!marketing && !integrationResult.rows[0]) return null;
  const mergedTokenExpiresAt = marketing?.token_expires_at || integration.token_expires_at || null;
  const mergedTokenExpiresIn = secondsUntil(mergedTokenExpiresAt);
  const tokenSaved = Boolean(marketing?.page_access_token || marketing?.access_token_encrypted || integration.page_access_token_encrypted);
  const staleTokenStatus = text(marketing?.token_status || integration.token_status || integration.status || "not_connected");
  const normalizedTokenStatus = tokenSaved && (mergedTokenExpiresIn === null || mergedTokenExpiresIn > 0) && staleTokenStatus === "token_expired"
    ? "active"
    : staleTokenStatus;
  const normalizedStatus = marketing?.is_connected || (tokenSaved && (mergedTokenExpiresIn === null || mergedTokenExpiresIn > 0))
    ? (["token_expired", "invalid", "revoked", "error", "not_connected"].includes(text(integration.status).toLowerCase()) ? "active" : integration.status || "active")
    : integration.status || "not_connected";
  const pageConnected = Boolean(marketing?.page_id || integration.facebook_page_id);
  const instagramConnected = Boolean(marketing?.instagram_account_id || integration.instagram_business_account_id);
  const validSavedConfig = Boolean(tokenSaved && pageConnected && instagramConnected && (mergedTokenExpiresIn === null || mergedTokenExpiresIn > 0));
  const permissionsSaved = integration.permissions_saved === true || integration.capability_status?.permissions?.ok === true || validSavedConfig;
  if (permissionsSaved && integration.permissions_saved !== true && integrationResult.rows[0]) {
    await db.query(
      `
      UPDATE meta_integration_configs
      SET permissions_saved = TRUE,
          capability_status = jsonb_set(COALESCE(capability_status, '{}'::jsonb), '{permissions}', $2::jsonb, true),
          status = CASE WHEN LOWER(COALESCE(status, '')) IN ('token_expired','missing_permissions','not_connected','invalid','revoked','error') THEN 'active' ELSE status END,
          updated_at = NOW()
      WHERE id = $1
      `,
      [integration.id, json({ ok: true, status: "connected", repaired_from_valid_config: true, checked_at: nowIso() })]
    ).catch(() => {});
    console.log("[meta-permissions] meta_permissions_repaired_from_valid_config", {
      tenant_id: scopedTenantId,
      config_id: integration.id || null,
      facebook_page_id: maskIdForLog(marketing?.page_id || integration.facebook_page_id),
      instagram_business_account_id: maskIdForLog(marketing?.instagram_account_id || integration.instagram_business_account_id),
    });
  }
  console.log("[meta-status] meta_status_config_selected", {
    tenant_id: scopedTenantId,
    config_id: integration.id || null,
    facebook_page_id: maskIdForLog(marketing?.page_id || integration.facebook_page_id),
    instagram_business_account_id: maskIdForLog(marketing?.instagram_account_id || integration.instagram_business_account_id),
    token_saved: tokenSaved,
    token_expires_at: mergedTokenExpiresAt,
    token_expires_in_seconds: mergedTokenExpiresIn,
    raw_status: integration.status || "",
    normalized_status: normalizedStatus,
    raw_token_status: staleTokenStatus,
    normalized_token_status: normalizedTokenStatus,
    permissions_saved: permissionsSaved,
  });
  const autoRefreshEnabled = Boolean(
    (process.env.META_APP_ID || process.env.FACEBOOK_APP_ID) &&
      (process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET) &&
      marketing?.long_lived_user_token
  );
  return {
    ...integration,
    tenant_id: scopedTenantId,
    facebook_page_id: marketing?.page_id || integration.facebook_page_id || "",
    page_name: integration.page_name || integration.facebook_page_name || "",
    facebook_page_name: integration.facebook_page_name || integration.page_name || "",
    page_access_token_encrypted: marketing?.page_access_token || marketing?.access_token_encrypted || integration.page_access_token_encrypted || "",
    instagram_business_account_id: marketing?.instagram_account_id || integration.instagram_business_account_id || "",
    instagram_username: integration.instagram_username || "",
    token_expires_at: mergedTokenExpiresAt,
    token_status: normalizedTokenStatus,
    token_health_status: normalizedTokenStatus,
    token_last_validated_at: marketing?.token_last_validated_at || integration.token_last_validated_at || null,
    auto_refresh_enabled: autoRefreshEnabled,
    last_auto_refresh_at: marketing?.last_auto_refresh_at || integration.last_auto_refresh_at || null,
    next_refresh_check_at: marketing?.next_refresh_check_at || integration.next_refresh_check_at || null,
    permissions_saved: permissionsSaved,
    status: normalizedStatus,
  };
};

const getRealMetaIntegrationConfig = async ({ tenantId, facebookPageId = "" } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const pageId = text(facebookPageId);
  const result = await db.query(
    `
    SELECT *
    FROM meta_integration_configs
    WHERE tenant_id = $1
      AND ($2::text = '' OR TRIM(facebook_page_id::text) = $2)
    ORDER BY
      CASE WHEN page_access_token_encrypted <> '' THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(token_expires_at, NOW() + INTERVAL '1 day') > NOW() THEN 0 ELSE 1 END,
      CASE WHEN LOWER(COALESCE(status, '')) IN ('fully_connected','active','connected','saved') THEN 0 ELSE 1 END,
      updated_at DESC
    LIMIT 1
    `,
    [scopedTenantId, pageId]
  );
  return result.rows[0] || null;
};

const repairMetaConfigFromMarketingSettings = async ({ tenantId } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  if (!scopedTenantId) return null;
  const real = await getRealMetaIntegrationConfig({ tenantId: scopedTenantId });
  if (real) return real;
  const marketingResult = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1
      AND (provider = 'meta' OR page_id <> '' OR page_access_token <> '' OR access_token_encrypted <> '')
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [scopedTenantId]
  ).catch(() => ({ rows: [] }));
  const marketing = marketingResult.rows[0] || null;
  const pageId = text(marketing?.page_id);
  const pageToken = decryptSecret(marketing?.page_access_token || marketing?.access_token_encrypted || "");
  if (!marketing || !pageId || !pageToken) return null;
  console.log("[meta-integration] meta_config_insert_attempt", {
    tenant_id: scopedTenantId,
    source: "marketing_settings_repair",
    facebook_page_id: maskIdForLog(pageId),
    instagram_business_account_id: maskIdForLog(marketing.instagram_account_id),
  });
  try {
    const result = await db.query(
      `
      INSERT INTO meta_integration_configs (
        tenant_id, facebook_page_id, page_name, facebook_page_name, page_access_token_encrypted,
        instagram_business_account_id, instagram_username, verify_token,
        webhook_enabled, webhook_verified, subscribed_apps_verified, permissions_saved,
        messenger_enabled, instagram_enabled, instagram_dm_enabled,
        token_expires_at, status, updated_at
      )
      VALUES ($1,$2,'','',$3,$4,'',$5,FALSE,FALSE,FALSE,TRUE,TRUE,$6,$6,$7::timestamp,'active',NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        facebook_page_id = EXCLUDED.facebook_page_id,
        page_access_token_encrypted = EXCLUDED.page_access_token_encrypted,
        instagram_business_account_id = EXCLUDED.instagram_business_account_id,
        verify_token = CASE WHEN meta_integration_configs.verify_token <> '' THEN meta_integration_configs.verify_token ELSE EXCLUDED.verify_token END,
        permissions_saved = TRUE,
        messenger_enabled = TRUE,
        instagram_enabled = EXCLUDED.instagram_enabled,
        instagram_dm_enabled = EXCLUDED.instagram_dm_enabled,
        token_expires_at = COALESCE(EXCLUDED.token_expires_at, meta_integration_configs.token_expires_at),
        status = CASE WHEN LOWER(COALESCE(meta_integration_configs.status, '')) IN ('fully_connected','active','connected','saved') THEN meta_integration_configs.status ELSE 'active' END,
        updated_at = NOW()
      RETURNING *
      `,
      [
        scopedTenantId,
        pageId,
        encryptSecret(pageToken),
        text(marketing.instagram_account_id),
        text(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || crypto.randomBytes(18).toString("hex")),
        Boolean(text(marketing.instagram_account_id)),
        marketing.token_expires_at || null,
      ]
    );
    const saved = result.rows[0] || null;
    console.log("[meta-integration] meta_config_insert_success", {
      tenant_id: scopedTenantId,
      config_id: saved?.id || null,
      facebook_page_id: maskIdForLog(saved?.facebook_page_id),
      source: "marketing_settings_repair",
    });
    return saved;
  } catch (error) {
    console.error("[meta-integration] meta_config_insert_failed", {
      tenant_id: scopedTenantId,
      source: "marketing_settings_repair",
      facebook_page_id: maskIdForLog(pageId),
      message: error?.message || "unknown",
      code: error?.code || "",
    });
    throw error;
  }
};

const defaultPublicConfig = (tenantId) => ({
  tenant_id: numberOrNull(tenantId),
  facebook_page_id: "",
  facebook_page_name: "",
  page_name: "",
  page_access_token_configured: false,
  page_access_token_masked: "",
  instagram_business_account_id: "",
  instagram_username: "",
  app_id: "",
  app_secret_configured: false,
  app_secret_masked: "",
  verify_token_configured: false,
  verify_token_masked: "",
  webhook_enabled: false,
  messenger_enabled: false,
  instagram_dm_enabled: false,
  instagram_enabled: false,
  facebook_publishing_enabled: false,
  instagram_publishing_enabled: false,
  last_sync_at: null,
  token_expires_at: null,
  capability_status: {},
  status: "not_connected",
});

const capabilityConnected = (capabilityStatus = {}, keys = []) =>
  keys.some((key) => {
    const capability = capabilityStatus?.[key] || {};
    return capability.ok === true || capability.connected === true || capability.status === "connected";
  });

const capabilityOk = (config = {}, key = "") => {
  const aliases = {
    facebook_messenger: ["facebook_messenger", "messenger"],
    instagram: ["instagram", "instagram_dm"],
    instagram_dm: ["instagram_dm", "instagram"],
  };
  return capabilityConnected(config.capability_status || {}, aliases[key] || [key]);
};

const normalizeWebhookField = (field = "") => text(field).trim().toLowerCase();

const normalizeWebhookFields = (value = []) => {
  const fields = new Set();
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (typeof entry === "string") {
      entry.split(",").forEach((field) => {
        const safe = normalizeWebhookField(field);
        if (safe) fields.add(safe);
      });
      return;
    }
    if (entry && typeof entry === "object") {
      if (entry.subscribed_fields !== undefined) visit(entry.subscribed_fields);
      if (entry.fields !== undefined) visit(entry.fields);
      if (entry.field !== undefined) visit(entry.field);
      if (entry.name !== undefined && entry.subscribed_fields === undefined) visit(entry.name);
      if (Array.isArray(entry.data)) visit(entry.data);
    }
  };
  visit(value);
  return [...fields];
};

const hasRequiredWebhookFields = (fields = [], required = META_WEBHOOK_REQUIRED_FIELDS) => {
  const normalized = new Set(normalizeWebhookFields(fields));
  return required.every((field) => normalized.has(normalizeWebhookField(field)));
};

const subscribedAppsVerified = (subscription = {}) => {
  const fields = normalizeWebhookFields(subscription.subscribed_fields);
  const appInstalled = subscription.app_installed !== false;
  const pageSubscriptionPresent = subscription.page_subscription_present !== false;
  return Boolean(
    appInstalled &&
      pageSubscriptionPresent &&
      hasRequiredWebhookFields(fields) &&
      (subscription.subscribed_apps_verified === true ||
        (subscription.subscribed_apps_status === "subscribed" && subscription.webhook_subscription_status === "subscribed"))
  );
};

const hasSavedPermissions = ({ permissions = {}, capabilityStatus = {}, config = {} } = {}) => {
  if (config.permissions_saved === true) return true;
  if (capabilityStatus?.permissions?.ok === true) return true;
  if (Array.isArray(permissions.granted) && permissions.granted.length > 0) return true;
  if (Object.values(capabilityStatus || {}).some((capability) => capability?.ok === true || capability?.status === "connected")) return true;
  if (
    config.page_access_token_configured &&
    ["active", "connected", "fully_connected", "saved"].includes(text(config.status).toLowerCase()) &&
    (config.messenger_enabled || config.instagram_dm_enabled || config.instagram_enabled)
  ) return true;
  return text(config.status).toLowerCase() === META_FULLY_CONNECTED_STATUS;
};

const evaluateMetaSetupCompletion = ({ config = {}, permissions = {}, webhookSubscription = null } = {}) => {
  const subscription = webhookSubscription || config.capability_status?.webhook?.subscribed_apps || {};
  const capabilityStatus = config.capability_status || {};
  const tokenActive = Boolean(
    config.page_access_token_configured &&
      !tokenExpired(config) &&
      (
        secondsUntil(config.token_expires_at) > 0 ||
        !["token_expired", "invalid", "revoked", "error"].includes(text(config.token_status || config.token_health_status).toLowerCase())
      )
  );
  const pageConnected = Boolean(config.facebook_page_id && config.page_access_token_configured);
  const messengerConnected = Boolean(
    pageConnected &&
      config.messenger_enabled &&
      capabilityConnected(capabilityStatus, ["messenger", "facebook_messenger"])
  );
  const instagramMessagingConnected = Boolean(
    pageConnected &&
      config.instagram_business_account_id &&
      (config.instagram_dm_enabled || config.instagram_enabled) &&
      capabilityConnected(capabilityStatus, ["instagram_dm", "instagram", "instagram_messaging"])
  );
  const operationalMessagingVerified = Boolean(tokenActive && pageConnected && messengerConnected && instagramMessagingConnected);
  const evaluation = {
    oauth_connected: Boolean(config.page_access_token_configured),
    page_selected: Boolean(config.facebook_page_id),
    instagram_connected: Boolean(config.instagram_business_account_id),
    permissions_saved: hasSavedPermissions({ permissions, capabilityStatus, config }),
    webhook_verified: Boolean(operationalMessagingVerified || config.webhook_verified || subscription.webhook_verified || (config.webhook_enabled && subscribedAppsVerified(subscription))),
    webhook_enabled: Boolean(operationalMessagingVerified || config.webhook_enabled || subscription.webhook_enabled),
    subscribed_apps_verified: Boolean(operationalMessagingVerified || config.subscribed_apps_verified || subscribedAppsVerified(subscription)),
    subscribed_fields: normalizeWebhookFields(subscription.subscribed_fields),
    operational_messaging_verified: operationalMessagingVerified,
    token_active: tokenActive,
    messenger_connected: messengerConnected,
    instagram_messaging_connected: instagramMessagingConnected,
    current_status: config.status || "not_connected",
  };
  evaluation.complete = Boolean(
    evaluation.oauth_connected &&
      evaluation.page_selected &&
      evaluation.instagram_connected &&
      evaluation.permissions_saved &&
      evaluation.webhook_verified &&
      evaluation.webhook_enabled &&
      evaluation.subscribed_apps_verified
  );
  evaluation.overall_status = evaluation.complete ? META_FULLY_CONNECTED_STATUS : config.status || "partially_connected";
  return evaluation;
};

const healthStatusFrom = ({ configured = false, tokenExpired = false, missingPermissions = [], webhookIssue = false } = {}) => {
  if (!configured) return "not_connected";
  if (tokenExpired) return "token_expired";
  if (webhookIssue) return "webhook_issue";
  if (missingPermissions.length) return "missing_permissions";
  return "connected";
};

const publicCapability = ({ key, label, configured, required = [], granted = [], testedAt = null, error = "", details = {} }) => {
  const missing = required.filter((permission) => !granted.includes(permission));
  return {
    key,
    label,
    status: error ? "partially_connected" : healthStatusFrom({ configured, missingPermissions: missing }),
    connected: Boolean(configured && !missing.length && !error),
    configured: Boolean(configured),
    required_permissions: required,
    missing_permissions: missing,
    last_checked_at: testedAt,
    error,
    details,
  };
};

const tokenExpired = (config = {}) => {
  if (!config.token_expires_at) return false;
  const date = parseMetaDate(config.token_expires_at);
  return Boolean(date && date.getTime() <= Date.now());
};

const daysBetween = (start, end = new Date()) => {
  if (!start) return null;
  const date = parseMetaDate(start);
  if (!date) return null;
  return Math.max(0, Math.floor((end.getTime() - date.getTime()) / 86400000));
};

const secondsUntil = (value) => {
  if (!value) return null;
  const date = parseMetaDate(value);
  if (!date) return null;
  return Math.floor((date.getTime() - Date.now()) / 1000);
};

const getTokenForConfig = (row = {}) => decryptSecret(row.page_access_token_encrypted || row.page_access_token || row.access_token_encrypted || "");

const metaAppConfig = () => ({
  appId: text(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID),
  appSecret: text(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
});

const redirectUriFor = (req = null) => {
  const configured = text(process.env.META_REDIRECT_URI);
  if (configured) return configured;
  const base = getPublicAppUrl() || (req ? `${req.protocol || "http"}://${req.get("host")}` : "");
  return `${base.replace(/\/+$/g, "")}/api/meta/oauth/callback`;
};

const frontendOriginFor = (req = null) => {
  const configured = text(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.CLIENT_URL || process.env.APP_URL);
  if (configured) return configured.replace(/\/+$/g, "");
  const origin = text(req?.get?.("origin"));
  if (origin) return origin.replace(/\/+$/g, "");
  const referer = text(req?.get?.("referer"));
  if (referer) {
    try {
      const parsed = new URL(referer);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return "";
    }
  }
  return "";
};

const backendOriginFor = (req = null) => {
  const configured = getPublicAppUrl();
  if (configured) return configured.replace(/\/+$/g, "");
  return req ? `${req.protocol || "http"}://${req.get("host")}`.replace(/\/+$/g, "") : "";
};

const setupEnvStatus = (req = null) => {
  const redirectUri = redirectUriFor(req);
  const frontendUrl = frontendOriginFor(req) || text(process.env.FRONTEND_URL || process.env.PUBLIC_FRONTEND_URL || process.env.VITE_PUBLIC_FRONTEND_URL);
  const required = {
    META_APP_ID: Boolean(text(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID)),
    META_APP_SECRET: Boolean(text(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET)),
    META_REDIRECT_URI: Boolean(text(process.env.META_REDIRECT_URI)),
    META_VERIFY_TOKEN: Boolean(text(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN)),
  };
  return {
    required,
    missing_env_vars: Object.entries(required).filter(([, present]) => !present).map(([key]) => key),
    redirect_uri: redirectUri,
    frontend_url: frontendUrl,
    backend_url: backendOriginFor(req),
  };
};

const assertMetaOAuthConfig = (req = null) => {
  const { appId, appSecret } = metaAppConfig();
  const redirectUri = redirectUriFor(req);
  if (!appId || !appSecret || !redirectUri) {
    throw Object.assign(new Error("Meta OAuth is not configured. Set META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI."), { status: 500 });
  }
  return { appId, appSecret, redirectUri };
};

const oauthDialogUrl = ({ state, req }) => {
  const { appId, redirectUri } = assertMetaOAuthConfig(req);
  const target = new URL("https://www.facebook.com/v20.0/dialog/oauth");
  target.searchParams.set("client_id", appId);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("state", state);
  target.searchParams.set("response_type", "code");
  target.searchParams.set("scope", META_OAUTH_SCOPES.join(","));
  target.searchParams.set("auth_type", "rerequest");
  return target.toString();
};

const exchangeOAuthCode = async ({ code, req }) => {
  const { appId, appSecret, redirectUri } = assertMetaOAuthConfig(req);
  const shortTokenPayload = await callMetaGet({
    endpoint: "/oauth/access_token",
    token: "",
    params: {
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    },
  });
  const shortToken = text(shortTokenPayload.access_token);
  if (!shortToken) throw Object.assign(new Error("Meta did not return a user access token."), { status: 502 });
  const longTokenPayload = await callMetaGet({
    endpoint: "/oauth/access_token",
    token: "",
    params: {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    },
  });
  const longToken = text(longTokenPayload.access_token);
  if (!longToken) throw Object.assign(new Error("Meta did not return a long-lived user token."), { status: 502 });
  return {
    longLivedUserToken: longToken,
    tokenExpiresAt: longTokenPayload.expires_in ? new Date(Date.now() + Number(longTokenPayload.expires_in) * 1000).toISOString() : null,
  };
};

const fetchManagedPages = async ({ userToken }) => {
  const payload = await callMetaGet({
    endpoint: "/me/accounts",
    token: userToken,
    params: { fields: "id,name,access_token,instagram_business_account{id,username}" },
  });
  const pages = Array.isArray(payload?.data) ? payload.data : [];
  return pages.map((page) => ({
    page_id: text(page.id),
    page_name: text(page.name),
    page_access_token_encrypted: encryptSecret(page.access_token || ""),
    page_access_token_masked: page.access_token ? maskSecret(page.access_token) : "",
    instagram_business_account_id: text(page.instagram_business_account?.id),
    instagram_username: text(page.instagram_business_account?.username),
  })).filter((page) => page.page_id && page.page_access_token_encrypted);
};

const publicOAuthPage = (page = {}) => ({
  page_id: page.page_id || "",
  page_name: page.page_name || "",
  page_access_token_configured: Boolean(page.page_access_token_encrypted),
  page_access_token_masked: page.page_access_token_masked || "",
  instagram_business_account_id: page.instagram_business_account_id || "",
  instagram_username: page.instagram_username || "",
});

const updateCapabilityStatus = async ({ tenantId, capabilityStatus = {}, status = "active" } = {}) => {
  await ensureMetaIntegrationSchema();
  const existing = await getMetaIntegrationConfig({ tenantId });
  const configForEvaluation = sanitizeConfig({
    ...(existing || {}),
    capability_status: capabilityStatus,
  });
  const completion = evaluateMetaSetupCompletion({ config: configForEvaluation });
  const nextStatus = completion.complete ? META_FULLY_CONNECTED_STATUS : status;
  console.log("[meta-setup] completion evaluation", {
    tenant_id: numberOrNull(tenantId),
    source: "capability_status",
    webhook_verified: completion.webhook_verified,
    webhook_enabled: completion.webhook_enabled,
    subscribed_fields: completion.subscribed_fields,
    subscribed_apps_verified: completion.subscribed_apps_verified,
    operational_messaging_verified: completion.operational_messaging_verified,
    overall_status_transition: `${existing?.status || "unknown"} -> ${nextStatus}`,
  });
  await db.query(
    `
    UPDATE meta_integration_configs
    SET capability_status = $2::jsonb,
        status = $3::text,
        permissions_saved = CASE WHEN COALESCE(($2::jsonb #>> '{permissions,ok}')::boolean, FALSE) OR $3::text IN ('active','connected','fully_connected') THEN TRUE ELSE permissions_saved END,
        webhook_enabled = CASE WHEN $4::boolean THEN TRUE ELSE webhook_enabled END,
        webhook_verified = CASE WHEN $4::boolean THEN TRUE ELSE webhook_verified END,
        subscribed_apps_verified = CASE WHEN $4::boolean THEN TRUE ELSE subscribed_apps_verified END,
        last_sync_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1
    `,
    [numberOrNull(tenantId), json(capabilityStatus), nextStatus, Boolean(completion.complete)]
  ).catch(() => {});
};

const capabilityStatusFromPublicCapabilities = (capabilities = {}) =>
  Object.fromEntries(Object.entries(capabilities || {}).map(([key, value]) => [key, {
    ok: value?.connected === true,
    status: value?.status || (value?.connected ? "connected" : "partially_connected"),
    missing_permissions: value?.missing_permissions || [],
    checked_at: value?.last_checked_at || nowIso(),
  }]));

const mergeCapabilityStatus = (existing = {}, next = {}) => {
  const merged = { ...(existing || {}) };
  Object.entries(next || {}).forEach(([key, value]) => {
    merged[key] = {
      ...(merged[key] || {}),
      ...(value || {}),
    };
  });
  return merged;
};

const repairDuplicateMetaConfigsForPage = async ({ facebookPageId = "" } = {}) => {
  const pageId = text(facebookPageId);
  if (!pageId) return { repaired: false, duplicate_count: 0, preferred_config_id: null };
  const result = await db.query(
    `
    SELECT id, tenant_id, status, webhook_enabled, token_expires_at, page_access_token_encrypted, updated_at
    FROM meta_integration_configs
    WHERE TRIM(facebook_page_id::text) = $1
    ORDER BY
      CASE WHEN page_access_token_encrypted <> '' THEN 0 ELSE 1 END,
      CASE WHEN COALESCE(token_expires_at, NOW() + INTERVAL '1 day') > NOW() THEN 0 ELSE 1 END,
      CASE WHEN LOWER(COALESCE(status, '')) IN ('fully_connected','active','connected','saved') THEN 0 ELSE 1 END,
      updated_at DESC
    `,
    [pageId]
  ).catch(() => ({ rows: [] }));
  if (result.rows.length <= 1) return { repaired: false, duplicate_count: 0, preferred_config_id: result.rows[0]?.id || null };
  const preferred = result.rows[0];
  const duplicates = result.rows.slice(1).map((row) => row.id).filter(Boolean);
  if (duplicates.length) {
    await db.query(
      `
      UPDATE meta_integration_configs
      SET webhook_enabled = FALSE,
          webhook_verified = FALSE,
          subscribed_apps_verified = FALSE,
          status = CASE WHEN status = 'fully_connected' THEN 'duplicate' ELSE status END,
          updated_at = NOW()
      WHERE id = ANY($1::bigint[])
      `,
      [duplicates]
    ).catch(() => {});
  }
  console.warn("[meta-integration] duplicate configs repaired", {
    facebook_page_id: maskIdForLog(pageId),
    preferred_config_id: preferred.id,
    preferred_tenant_id: preferred.tenant_id,
    duplicate_config_ids: duplicates,
  });
  return { repaired: true, duplicate_count: duplicates.length, preferred_config_id: preferred.id };
};

const REQUIRED_CAPABILITY_PERMISSIONS = {
  messenger: ["pages_messaging"],
  instagram_dm: ["instagram_manage_messages"],
  facebook_publishing: ["pages_manage_posts", "pages_read_engagement"],
  instagram_publishing: ["instagram_content_publish", "instagram_basic"],
  webhook: [],
};

const allRequiredMetaPermissions = () =>
  [...new Set(Object.values(REQUIRED_CAPABILITY_PERMISSIONS).flat().filter(Boolean))];

const getGrantedPermissions = async ({ token }) => {
  console.log("[meta-permissions] meta_permissions_live_check_start", {
    token_present: Boolean(text(token)),
  });
  if (!token) {
    console.warn("[meta-permissions] meta_permissions_live_check_failed", { reason: "missing_token" });
    return { granted: [], checked_at: nowIso(), check_failed: true, permissions_unknown: true, error: "Page access token is missing" };
  }
  try {
    const appId = text(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
    const appSecret = text(process.env.META_APP_SECRET || process.env.FACEBOOK_APP_SECRET);
    if (appId && appSecret) {
      const payload = await callMetaGet({
        endpoint: "/debug_token",
        token: `${appId}|${appSecret}`,
        params: { input_token: token },
      });
      const data = payload?.data || {};
      const scopes = [
        ...(Array.isArray(data.scopes) ? data.scopes : []),
        ...(Array.isArray(data.granular_scopes) ? data.granular_scopes.map((scope) => scope?.scope) : []),
      ];
      const granted = [...new Set(scopes.map(text).filter(Boolean))];
      console.log("[meta-permissions] meta_permissions_live_check_result", {
        granted,
        source: "debug_token",
        is_valid: data.is_valid !== false,
      });
      return {
        granted,
        checked_at: nowIso(),
        is_valid: data.is_valid !== false,
        expires_at: data.expires_at ? new Date(Number(data.expires_at) * 1000).toISOString() : null,
        check_failed: false,
      };
    }
    const payload = await callMetaGet({ endpoint: "/me/permissions", token });
    const granted = (Array.isArray(payload?.data) ? payload.data : [])
      .filter((permission) => permission?.status === "granted")
      .map((permission) => text(permission.permission))
      .filter(Boolean);
    console.log("[meta-permissions] meta_permissions_live_check_result", {
      granted,
      source: "me_permissions",
      is_valid: true,
    });
    return {
      granted,
      checked_at: nowIso(),
      is_valid: true,
      check_failed: false,
    };
  } catch (error) {
    console.warn("[meta-permissions] meta_permissions_live_check_failed", {
      message: error?.message || "Unable to verify Meta permissions",
      status: error?.status || null,
    });
    return {
      granted: [],
      checked_at: nowIso(),
      is_valid: undefined,
      check_failed: true,
      permissions_unknown: true,
      error: error?.message || "Unable to verify Meta permissions",
    };
  }
};

const normalizeSubscribedFields = (items = []) => normalizeWebhookFields(items);

const getPageSubscribedApps = async ({ pageId, token }) => {
  if (!text(pageId) || !text(token)) {
    return { ok: false, subscribed_fields: [], error: "Facebook Page ID and Page access token are required" };
  }
  try {
    const payload = await callMetaGet({
      endpoint: `/${encodeURIComponent(text(pageId))}/subscribed_apps`,
      token,
      params: { fields: "id,name,subscribed_fields" },
    });
    if (process.env.NODE_ENV !== "production") {
      console.log("[meta-webhook] subscribed_apps raw verification response", {
        page_id: text(pageId),
        response: payload,
      });
    }
    const data = Array.isArray(payload?.data) ? payload.data : payload && typeof payload === "object" ? [payload] : [];
    const appId = text(process.env.META_APP_ID || process.env.FACEBOOK_APP_ID);
    const appRow = data.find((item) => !appId || text(item?.id) === appId) || data[0] || null;
    const subscribedFields = normalizeSubscribedFields(appRow ? [appRow] : data);
    const appInstalled = Boolean(appRow);
    const pageSubscriptionPresent = Boolean(appInstalled && subscribedFields.length);
    return {
      ok: Boolean(appInstalled && hasRequiredWebhookFields(subscribedFields)),
      app_installed: appInstalled,
      page_subscription_present: pageSubscriptionPresent,
      app_id: appRow?.id || "",
      app_name: appRow?.name || "",
      subscribed_fields: subscribedFields,
      raw_count: data.length,
      checked_at: nowIso(),
    };
  } catch (error) {
    return {
      ok: false,
      subscribed_fields: [],
      error: error?.message || "Unable to verify Meta subscribed apps",
      meta: error?.meta || null,
      checked_at: nowIso(),
    };
  }
};

const updateWebhookSubscriptionStatus = async ({ tenantId, status = {}, webhookEnabled = false } = {}) => {
  const existing = await getMetaIntegrationConfig({ tenantId });
  const capabilityStatus = existing?.capability_status && typeof existing.capability_status === "object" ? existing.capability_status : {};
  const nextCapabilityStatus = {
    ...capabilityStatus,
    webhook: {
      ...(capabilityStatus.webhook || {}),
      ok: Boolean(webhookEnabled),
      status: webhookEnabled ? "connected" : "webhook_issue",
      subscribed_apps: status,
      checked_at: nowIso(),
    },
    messaging: {
      ...(capabilityStatus.messaging || {}),
      ok: Boolean(webhookEnabled),
      status: webhookEnabled ? "connected" : capabilityStatus.messaging?.status || "pending",
      checked_at: nowIso(),
    },
    permissions: {
      ...(capabilityStatus.permissions || {}),
      ok: webhookEnabled ? true : capabilityStatus.permissions?.ok === true,
      status: webhookEnabled ? "connected" : capabilityStatus.permissions?.status || "permissions_unknown",
      checked_at: nowIso(),
    },
  };
  const configForEvaluation = sanitizeConfig({
    ...(existing || {}),
    webhook_enabled: Boolean(webhookEnabled),
    capability_status: nextCapabilityStatus,
  });
  const completion = evaluateMetaSetupCompletion({ config: configForEvaluation, webhookSubscription: status });
  const nextStatus = completion.complete ? META_FULLY_CONNECTED_STATUS : webhookEnabled ? "active" : existing?.status || "partial";
  console.log("[meta-setup] completion evaluation", {
    tenant_id: numberOrNull(tenantId),
      source: "webhook_subscription",
      webhook_verified: completion.webhook_verified,
      webhook_enabled: completion.webhook_enabled,
      subscribed_fields: completion.subscribed_fields,
      subscribed_apps_verified: completion.subscribed_apps_verified,
      operational_messaging_verified: completion.operational_messaging_verified,
      permissions_saved: completion.permissions_saved,
      overall_status_transition: `${existing?.status || "unknown"} -> ${nextStatus}`,
    });
  await db.query(
    `
    UPDATE meta_integration_configs
    SET webhook_enabled = $2,
        webhook_verified = $2,
        subscribed_apps_verified = $2,
        permissions_saved = CASE WHEN $2::boolean THEN TRUE ELSE permissions_saved END,
        capability_status = $3::jsonb,
        status = $4::text,
        last_sync_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1
    `,
    [
      numberOrNull(tenantId),
      Boolean(webhookEnabled),
      json(nextCapabilityStatus),
      nextStatus,
    ]
  ).catch(() => {});
  if (webhookEnabled) {
    console.log("[meta-webhook] meta_verify_webhook_persisted", {
      tenant_id: numberOrNull(tenantId),
      webhook_enabled: true,
      webhook_verified: true,
      subscribed_apps_verified: true,
      webhook_subscription_status: status.webhook_subscription_status || "",
      permissions_saved: true,
      status: nextStatus,
    });
  }
  if (completion.complete || webhookEnabled) {
    console.log("[meta-setup] meta_complete_setup_saved", {
      tenant_id: numberOrNull(tenantId),
      webhook_enabled: Boolean(webhookEnabled),
      webhook_verified: completion.webhook_verified,
      subscribed_apps_verified: completion.subscribed_apps_verified,
      permissions_saved: completion.permissions_saved,
      overall_status: nextStatus,
    });
  }
  return completion;
};

export const subscribeMetaPageToWebhooks = async ({ tenantId, pageId = "", pageAccessToken = "" } = {}) => {
  await ensureMetaIntegrationSchema();
  console.log("[meta-webhook] meta_verify_webhook_action_start", {
    tenant_id: numberOrNull(tenantId),
    page_id_requested: maskIdForLog(pageId),
    page_token_provided: Boolean(text(pageAccessToken)),
  });
  let row = await getRealMetaIntegrationConfig({ tenantId, facebookPageId: pageId });
  if (!row) row = await repairMetaConfigFromMarketingSettings({ tenantId });
  if (!row) {
    const error = Object.assign(new Error("Meta integration config row is missing. Reconnect Meta so the selected page can be persisted before verifying the webhook."), { status: 409 });
    console.error("[meta-webhook] meta_verify_webhook_action_result", {
      tenant_id: numberOrNull(tenantId),
      success: false,
      config_id: null,
      error: error.message,
    });
    throw error;
  }
  const resolvedPageId = text(pageId || row?.facebook_page_id);
  const token = text(pageAccessToken) || (row ? getTokenForConfig(row) : "");
  console.log("[meta-webhook] meta_verify_webhook_config_selected", {
    tenant_id: numberOrNull(tenantId),
    config_id: row?.id || null,
    facebook_page_id: maskIdForLog(resolvedPageId),
    instagram_business_account_id: maskIdForLog(row?.instagram_business_account_id),
    token_saved: Boolean(token),
    webhook_enabled_before: row?.webhook_enabled === true,
    webhook_verified_before: row?.webhook_verified === true,
    subscribed_apps_verified_before: row?.subscribed_apps_verified === true,
  });
  const result = {
    page_id: resolvedPageId,
    requested_fields: META_WEBHOOK_SUBSCRIBED_FIELDS,
    fallback_requested_fields: META_WEBHOOK_MINIMAL_FIELDS,
    subscribed_fields: [],
    required_fields: META_WEBHOOK_REQUIRED_FIELDS,
    missing_required_fields: META_WEBHOOK_REQUIRED_FIELDS,
    missing_optional_fields: META_WEBHOOK_SUBSCRIBED_FIELDS,
    comment_events_source: "feed",
    comments_available: false,
    subscribed_apps_status: "not_subscribed",
    webhook_subscription_status: "not_subscribed",
    webhook_verification_status: text(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN) ? "verify_token_configured" : "verify_token_missing",
    webhook_enabled: false,
    webhook_verified: false,
    subscribed_apps_verified: false,
    app_installed: false,
    page_subscription_present: false,
    post_subscription_success: false,
    posted_fields: [],
    error: "",
    meta: null,
    checked_at: nowIso(),
  };

  if (!resolvedPageId || !token) {
    result.error = "Facebook Page ID and Page access token are required";
    await updateWebhookSubscriptionStatus({ tenantId, status: result, webhookEnabled: false });
    return result;
  }

  const postSubscription = async (fields) =>
    (console.log("[meta-webhook] meta_subscribed_apps_request", {
      tenant_id: numberOrNull(tenantId),
      facebook_page_id: maskIdForLog(resolvedPageId),
      subscribed_fields: fields,
    }),
    callMetaPostForm({
      endpoint: `/${encodeURIComponent(resolvedPageId)}/subscribed_apps`,
      token,
      body: { subscribed_fields: fields.join(",") },
    }));

  let postedFields;
  try {
    postedFields = normalizeWebhookFields(META_WEBHOOK_SUBSCRIBED_FIELDS);
    result.meta = await postSubscription(META_WEBHOOK_SUBSCRIBED_FIELDS);
    console.log("[meta-webhook] meta_subscribed_apps_success", {
      tenant_id: numberOrNull(tenantId),
      facebook_page_id: maskIdForLog(resolvedPageId),
      subscribed_fields: postedFields,
    });
  } catch (error) {
    result.meta = error?.meta || null;
    console.warn("[meta-webhook] meta_subscribed_apps_failed", {
      tenant_id: numberOrNull(tenantId),
      facebook_page_id: maskIdForLog(resolvedPageId),
      subscribed_fields: META_WEBHOOK_SUBSCRIBED_FIELDS,
      message: error?.message || "Meta rejected Page webhook fields",
      meta: error?.meta || null,
    });
    try {
      result.subscription_retry = {
        reason: error?.message || "Meta rejected one or more Page webhook fields",
        requested_fields: META_WEBHOOK_MINIMAL_FIELDS,
      };
      postedFields = normalizeWebhookFields(META_WEBHOOK_MINIMAL_FIELDS);
      result.meta = await postSubscription(META_WEBHOOK_MINIMAL_FIELDS);
      console.log("[meta-webhook] meta_subscribed_apps_success", {
        tenant_id: numberOrNull(tenantId),
        facebook_page_id: maskIdForLog(resolvedPageId),
        subscribed_fields: postedFields,
        fallback: true,
      });
    } catch (retryError) {
      result.error = retryError?.message || error?.message || "Unable to subscribe Facebook Page to app webhooks";
      result.meta = retryError?.meta || error?.meta || null;
      console.warn("[meta-webhook] meta_subscribed_apps_failed", {
        tenant_id: numberOrNull(tenantId),
        facebook_page_id: maskIdForLog(resolvedPageId),
        subscribed_fields: META_WEBHOOK_MINIMAL_FIELDS,
        message: result.error,
        meta: result.meta,
        fallback: true,
      });
      const completion = await updateWebhookSubscriptionStatus({ tenantId, status: result, webhookEnabled: false });
      result.overall_status = completion.overall_status;
      result.setup_completion = completion;
      console.log("[meta-webhook] meta_verify_webhook_action_result", {
        tenant_id: numberOrNull(tenantId),
        success: false,
        error: result.error,
        webhook_enabled: false,
      });
      return result;
    }
  }
  result.post_subscription_success = true;
  result.posted_fields = postedFields;

  const verification = await getPageSubscribedApps({ pageId: resolvedPageId, token });
  const verifiedFields = normalizeWebhookFields(verification.subscribed_fields);
  result.subscribed_fields = verifiedFields.length ? verifiedFields : postedFields;
  result.verification_fields_source = verifiedFields.length ? "meta_get_subscribed_apps" : "post_subscribed_apps";
  result.app_installed = Boolean(verification.app_installed || verification.ok || result.post_subscription_success);
  result.page_subscription_present = Boolean(verification.page_subscription_present || verification.ok || result.post_subscription_success);
  result.missing_required_fields = META_WEBHOOK_REQUIRED_FIELDS.filter((field) => !hasRequiredWebhookFields(result.subscribed_fields, [field]));
  result.missing_optional_fields = META_WEBHOOK_SUBSCRIBED_FIELDS.filter((field) => !hasRequiredWebhookFields(result.subscribed_fields, [field]));
  result.comments_available = result.subscribed_fields.includes("feed");
  result.subscribed_apps_verified = Boolean(result.app_installed && result.page_subscription_present && !result.missing_required_fields.length);
  result.subscribed_apps_status = result.subscribed_apps_verified ? "subscribed" : "not_subscribed";
  result.webhook_subscription_status = result.subscribed_apps_verified ? "subscribed" : "partial";
  if (verification.error) result.verification_error = verification.error;
  result.webhook_verified = Boolean(result.subscribed_apps_verified && text(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN));
  result.webhook_enabled = result.webhook_verified;
  result.webhook_verification_status = result.webhook_verified ? "verified" : result.webhook_verification_status;
  if (verification.error && !result.subscribed_apps_verified) result.error = verification.error;
  const completion = await updateWebhookSubscriptionStatus({ tenantId, status: result, webhookEnabled: result.webhook_enabled });
  result.overall_status = completion.overall_status;
  result.setup_completion = completion;
  console.log("[meta-webhook] meta_verify_webhook_action_result", {
    tenant_id: numberOrNull(tenantId),
    success: result.webhook_enabled === true,
    webhook_enabled: result.webhook_enabled,
    webhook_verified: result.webhook_verified,
    subscribed_apps_verified: result.subscribed_apps_verified,
    error: result.error || "",
  });
  return result;
};

export const verifyMetaWebhookEnablement = async ({ tenantId } = {}) => {
  return subscribeMetaPageToWebhooks({ tenantId });
};

const buildMissingItems = (items = []) => items.filter((item) => !item.done).map((item) => item.label);

const hasPageTokenAndPage = (config = {}) => Boolean(config.page_access_token_configured && config.facebook_page_id);
const hasInstagramBase = (config = {}) => Boolean(hasPageTokenAndPage(config) && config.instagram_business_account_id);

const buildMetaChannels = (config = {}, setupCompletion = null) => {
  const tokenValid = Boolean(config.page_access_token_configured && !tokenExpired(config));
  const webhookOperational = Boolean(
    setupCompletion?.webhook_verified &&
      setupCompletion?.webhook_enabled &&
      setupCompletion?.subscribed_apps_verified
  );
  const messengerOperational = Boolean(tokenValid && hasPageTokenAndPage(config) && webhookOperational);
  const instagramOperational = Boolean(tokenValid && hasInstagramBase(config) && webhookOperational);
  const messengerConnected = Boolean((config.messenger_enabled && hasPageTokenAndPage(config) && capabilityOk(config, "facebook_messenger")) || messengerOperational);
  const facebookPublishingConnected = Boolean(config.facebook_publishing_enabled && hasPageTokenAndPage(config) && capabilityOk(config, "facebook_publishing"));
  const instagramDmConnected = Boolean((config.instagram_dm_enabled && hasInstagramBase(config) && capabilityOk(config, "instagram_dm")) || instagramOperational);
  const instagramPublishingConnected = Boolean(config.instagram_publishing_enabled && hasInstagramBase(config) && capabilityOk(config, "instagram_publishing"));
  return {
    facebook: {
      connected: messengerConnected || facebookPublishingConnected,
      messenger_connected: messengerConnected,
      webhook_healthy: webhookOperational,
      token_valid: tokenValid,
      messaging_active: messengerConnected,
      operational_source: messengerOperational ? "webhook_verified" : "capability_status",
      publishing_connected: facebookPublishingConnected,
      messenger_enabled: config.messenger_enabled,
      publishing_enabled: config.facebook_publishing_enabled,
      page_id: config.facebook_page_id,
      page_name: config.facebook_page_name || config.page_name || "",
      last_sync_at: config.last_sync_at,
      token_expires_at: config.token_expires_at,
      missing: {
        messenger: buildMissingItems([
          { done: config.page_access_token_configured, label: "page_access_token" },
          { done: Boolean(config.facebook_page_id), label: "facebook_page_id" },
          { done: capabilityOk(config, "facebook_messenger") || messengerOperational, label: "messenger_permission_test" },
        ]),
        publishing: buildMissingItems([
          { done: config.page_access_token_configured, label: "page_access_token" },
          { done: Boolean(config.facebook_page_id), label: "facebook_page_id" },
          { done: capabilityOk(config, "facebook_publishing"), label: "publish_permission_test" },
        ]),
      },
    },
    instagram: {
      connected: instagramDmConnected || instagramPublishingConnected,
      dm_connected: instagramDmConnected,
      webhook_healthy: webhookOperational,
      token_valid: tokenValid,
      messaging_active: instagramDmConnected,
      operational_source: instagramOperational ? "webhook_verified" : "capability_status",
      publishing_connected: instagramPublishingConnected,
      dm_enabled: config.instagram_dm_enabled,
      publishing_enabled: config.instagram_publishing_enabled,
      business_account_id: config.instagram_business_account_id,
      username: config.instagram_username,
      last_sync_at: config.last_sync_at,
      token_expires_at: config.token_expires_at,
      missing: {
        dm: buildMissingItems([
          { done: config.page_access_token_configured, label: "page_access_token" },
          { done: Boolean(config.instagram_business_account_id), label: "instagram_business_account_id" },
          { done: capabilityOk(config, "instagram_dm") || instagramOperational, label: "instagram_messaging_permission_test" },
        ]),
        publishing: buildMissingItems([
          { done: config.page_access_token_configured, label: "page_access_token" },
          { done: Boolean(config.instagram_business_account_id), label: "instagram_business_account_id" },
          { done: capabilityOk(config, "instagram_publishing"), label: "instagram_content_publish_test" },
        ]),
      },
    },
  };
};

export const getMetaIntegrationStatus = async ({ tenantId, req = null } = {}) => {
  await repairMetaConfigFromMarketingSettings({ tenantId }).catch((error) => {
    console.warn("[meta-status] marketing_settings repair failed", {
      tenant_id: numberOrNull(tenantId),
      message: error?.message || "unknown",
    });
  });
  const row = await getMetaIntegrationConfig({ tenantId });
  const config = row ? sanitizeConfig(row) : defaultPublicConfig(tenantId);
  const webhookUrl = `${backendOriginFor(req)}/api/meta/webhook`;
  if (config.facebook_page_id) {
    await repairDuplicateMetaConfigsForPage({ facebookPageId: config.facebook_page_id }).catch((error) => {
      console.warn("[meta-status] duplicate safety repair failed", {
        tenant_id: numberOrNull(tenantId),
        facebook_page_id: maskIdForLog(config.facebook_page_id),
        message: error?.message || "unknown",
      });
    });
  }
  const webhookSubscription = {
    ...(config.capability_status?.webhook?.subscribed_apps || {}),
    webhook_enabled: config.webhook_enabled || config.capability_status?.webhook?.subscribed_apps?.webhook_enabled,
    webhook_verified: config.webhook_verified || config.capability_status?.webhook?.subscribed_apps?.webhook_verified,
    subscribed_apps_verified: config.subscribed_apps_verified || config.capability_status?.webhook?.subscribed_apps?.subscribed_apps_verified,
  };
  const setupCompletion = evaluateMetaSetupCompletion({ config, webhookSubscription });
  const subscribedAppsOk = setupCompletion.subscribed_apps_verified;
  const webhookVerified = setupCompletion.webhook_verified;
  console.log("[meta-status] meta_status_token_check", {
    tenant_id: numberOrNull(tenantId),
    config_id: config.id || null,
    token_saved: config.page_access_token_configured,
    token_expires_at: config.token_expires_at,
    token_expires_in_seconds: secondsUntil(config.token_expires_at),
    token_expired: tokenExpired(config),
    token_status: config.token_status,
    overall_status: setupCompletion.complete ? META_FULLY_CONNECTED_STATUS : config.status,
  });
  console.log("[meta-status] meta_status_permission_check", {
    tenant_id: numberOrNull(tenantId),
    config_id: config.id || null,
    permissions_saved: setupCompletion.permissions_saved,
    messenger_enabled: config.messenger_enabled,
    instagram_dm_enabled: config.instagram_dm_enabled,
    capability_keys: Object.keys(config.capability_status || {}),
  });
  console.log("[meta-status] meta_status_webhook_flags", {
    tenant_id: numberOrNull(tenantId),
    config_id: config.id || null,
    webhook_enabled: setupCompletion.webhook_enabled,
    webhook_verified: setupCompletion.webhook_verified,
    subscribed_apps_verified: setupCompletion.subscribed_apps_verified,
    physical_webhook_enabled: config.webhook_enabled,
    physical_webhook_verified: config.webhook_verified,
    physical_subscribed_apps_verified: config.subscribed_apps_verified,
  });
  return {
    config,
    webhook_url: webhookUrl,
    subscribed_apps: webhookSubscription,
    overall_status: setupCompletion.complete ? META_FULLY_CONNECTED_STATUS : config.status,
    setup_completion: setupCompletion,
    checklist: {
      meta_app_created: Boolean(config.app_id),
      page_connected: Boolean(config.facebook_page_id && config.page_access_token_configured),
      instagram_professional_linked: Boolean(config.instagram_business_account_id),
      webhook_verified: webhookVerified,
      webhook_enabled: setupCompletion.webhook_enabled,
      subscribed_apps: subscribedAppsOk,
      token_saved: config.page_access_token_configured,
    },
    channels: buildMetaChannels(config, setupCompletion),
  };
};

const latestValue = (rows = [], key = "created_at") => rows[0]?.[key] || null;

const safeDb = async (query, params = [], fallback = { rows: [] }) => {
  try {
    return await db.query(query, params);
  } catch (error) {
    if (["42P01", "42703"].includes(error?.code)) return fallback;
    throw error;
  }
};

export const getMetaWebhookHealth = async ({ tenantId, req = null } = {}) => {
  const scopedTenantId = numberOrNull(tenantId);
  const status = await getMetaIntegrationStatus({ tenantId: scopedTenantId, req });
  const [events, messages, posts, commentLogs] = await Promise.all([
    safeDb(
      `
      SELECT created_at, status, error, message_preview
      FROM ai_channel_event_logs
      WHERE tenant_id = $1
        AND channel IN ('facebook_messenger','instagram')
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [scopedTenantId]
    ),
    safeDb(
      `
      SELECT created_at, message_text, channel
      FROM ai_support_messages
      WHERE tenant_id = $1
        AND channel IN ('facebook','instagram','facebook_messenger')
        AND sender_type = 'customer'
      ORDER BY created_at DESC
      LIMIT 20
      `,
      [scopedTenantId]
    ),
    safeDb(
      `
      SELECT published_at, updated_at, status, error_message
      FROM marketing_posts
      WHERE tenant_id = $1
        AND (published_at IS NOT NULL OR status = 'failed')
      ORDER BY COALESCE(published_at, updated_at, created_at) DESC
      LIMIT 100
      `,
      [scopedTenantId]
    ),
    safeDb(
      `
      SELECT created_at, updated_at, status, error_message
      FROM marketing_comment_dm_logs
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [scopedTenantId]
    ),
  ]);
  const failedEvents = events.rows.filter((event) => ["failed", "error"].includes(text(event.status).toLowerCase()) || event.error);
  const failedCommentLogs = commentLogs.rows.filter((log) => text(log.status).toLowerCase() === "failed" || log.error_message);
  const successfulPost = posts.rows.find((post) => text(post.status).toLowerCase() === "published" || post.published_at) || null;
  const failedPostCount = posts.rows.filter((post) => text(post.status).toLowerCase() === "failed" || post.error_message).length;
  const lastRetry = [...failedEvents, ...failedCommentLogs].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))[0] || null;
  return {
    webhook_url: status.webhook_url,
    subscribed_apps: status.subscribed_apps || {},
    setup_completion: status.setup_completion || {},
    subscribed_apps_status: status.subscribed_apps?.subscribed_apps_status || "unknown",
    webhook_subscription_status: status.subscribed_apps?.webhook_subscription_status || "unknown",
    webhook_verification_status: status.subscribed_apps?.webhook_verification_status || (status.checklist?.webhook_verified ? "verified" : "unverified"),
    webhook_verified: Boolean(status.checklist?.webhook_verified),
    webhook_enabled: Boolean(status.config?.webhook_enabled),
    last_webhook_event: latestValue(events.rows),
    last_incoming_message: latestValue(messages.rows),
    last_successful_publish: successfulPost?.published_at || successfulPost?.updated_at || null,
    failed_webhook_deliveries: failedEvents.length + failedCommentLogs.length,
    failed_publishes: failedPostCount,
    last_retry: lastRetry?.updated_at || lastRetry?.created_at || null,
    event_throughput_24h: events.rows.filter((event) => new Date(event.created_at).getTime() >= Date.now() - 86400000).length,
    recent_events: events.rows.slice(0, 10),
  };
};

export const getMetaCapabilities = async ({ tenantId, req = null, live = true } = {}) => {
  const row = await getMetaIntegrationConfig({ tenantId });
  const config = row ? sanitizeConfig(row) : defaultPublicConfig(tenantId);
  const token = row ? getTokenForConfig(row) : "";
  const permissions = live ? await getGrantedPermissions({ token }) : { granted: [], checked_at: null };
  const webhook = await getMetaWebhookHealth({ tenantId, req }).catch(() => ({}));
  const pageConfigured = Boolean(config.page_access_token_configured && config.facebook_page_id);
  const igConfigured = Boolean(pageConfigured && config.instagram_business_account_id);
  const tokenIsExpired = tokenExpired(config);
  const permissionUnknown = permissions.check_failed === true || permissions.permissions_unknown === true;
  const persistedPermissionsSaved = config.permissions_saved === true || config.capability_status?.permissions?.ok === true;
  const effectiveGranted = permissionUnknown && persistedPermissionsSaved && !tokenIsExpired
    ? allRequiredMetaPermissions()
    : Array.isArray(permissions.granted) ? permissions.granted : [];
  const explicitlyMissing = !permissionUnknown && permissions.is_valid !== false
    ? allRequiredMetaPermissions().filter((permission) => !effectiveGranted.includes(permission))
    : [];
  if (explicitlyMissing.length) {
    console.warn("[meta-permissions] meta_permissions_explicitly_missing", {
      tenant_id: numberOrNull(tenantId),
      missing_permissions: explicitlyMissing,
      granted_permissions: effectiveGranted,
    });
  }
  if (persistedPermissionsSaved && permissionUnknown && !tokenIsExpired) {
    console.log("[meta-permissions] meta_permissions_repaired_from_valid_config", {
      tenant_id: numberOrNull(tenantId),
      config_id: config.id || null,
      reason: "live_check_unknown_persisted_permissions",
    });
  }
  const tokenValidationFailed = permissions.is_valid === false;
  const baseError = tokenIsExpired
    ? (permissions.error || "Token expired or invalid")
    : tokenValidationFailed && !persistedPermissionsSaved
      ? permissions.error || "Unable to validate Meta permissions"
      : permissionUnknown && !persistedPermissionsSaved
        ? permissions.error || "Meta permissions could not be verified"
      : permissions.error || "";
  const capabilities = {
    messenger: publicCapability({
      key: "messenger",
      label: "Facebook Messenger",
      configured: pageConfigured,
      required: REQUIRED_CAPABILITY_PERMISSIONS.messenger,
      granted: effectiveGranted,
      testedAt: permissions.checked_at,
      error: baseError,
      details: {
        receive_messages: pageConfigured && !tokenIsExpired,
        send_replies: pageConfigured && effectiveGranted.includes("pages_messaging"),
        comment_to_dm: pageConfigured,
        auto_replies: Boolean(config.messenger_enabled),
        human_takeover: true,
      },
    }),
    instagram_dm: publicCapability({
      key: "instagram_dm",
      label: "Instagram DM",
      configured: igConfigured,
      required: REQUIRED_CAPABILITY_PERMISSIONS.instagram_dm,
      granted: effectiveGranted,
      testedAt: permissions.checked_at,
      error: baseError,
      details: {
        receive_dms: igConfigured && !tokenIsExpired,
        send_replies: igConfigured && effectiveGranted.includes("instagram_manage_messages"),
        story_mention_support: "future_ready",
        automation_status: config.instagram_dm_enabled ? "enabled" : "disabled",
      },
    }),
    facebook_publishing: publicCapability({
      key: "facebook_publishing",
      label: "Facebook publishing",
      configured: pageConfigured,
      required: REQUIRED_CAPABILITY_PERMISSIONS.facebook_publishing,
      granted: effectiveGranted,
      testedAt: permissions.checked_at,
      error: baseError,
      details: {
        feed_publishing: pageConfigured,
        media_upload: pageConfigured,
        scheduled_publishing: true,
        failed_publishes: webhook.failed_publishes || 0,
      },
    }),
    instagram_publishing: publicCapability({
      key: "instagram_publishing",
      label: "Instagram publishing",
      configured: igConfigured,
      required: REQUIRED_CAPABILITY_PERMISSIONS.instagram_publishing,
      granted: effectiveGranted,
      testedAt: permissions.checked_at,
      error: baseError,
      details: {
        feed_publishing: igConfigured,
        media_upload: igConfigured,
        scheduled_publishing: true,
        failed_publishes: webhook.failed_publishes || 0,
      },
    }),
    webhook: {
      key: "webhook",
      label: "Webhook delivery",
      status: webhook.webhook_verified ? "connected" : "webhook_issue",
      connected: Boolean(webhook.webhook_verified),
      required_permissions: [],
      missing_permissions: [],
      last_checked_at: nowIso(),
      details: webhook,
    },
  };
  const values = Object.values(capabilities);
  const connectedCount = values.filter((item) => item.connected).length;
  const refreshedCapabilityStatus = mergeCapabilityStatus(
    config.capability_status,
    {
      ...capabilityStatusFromPublicCapabilities(capabilities),
      permissions: {
        ok: Boolean(persistedPermissionsSaved || (!permissionUnknown && !explicitlyMissing.length && permissions.is_valid !== false)),
        status: permissionUnknown && !persistedPermissionsSaved ? "permissions_unknown" : explicitlyMissing.length ? "missing_permissions" : "connected",
        granted: effectiveGranted,
        missing_permissions: explicitlyMissing,
        checked_at: permissions.checked_at || nowIso(),
      },
    }
  );
  const setupCompletion = evaluateMetaSetupCompletion({
    config: {
      ...config,
      capability_status: refreshedCapabilityStatus,
    },
    permissions: {
      ...permissions,
      granted: effectiveGranted,
    },
    webhookSubscription: {
      ...(webhook.subscribed_apps || {}),
      webhook_verified: webhook.webhook_verified,
      webhook_enabled: webhook.webhook_enabled,
    },
  });
  const nextStatus = setupCompletion.complete
    ? META_FULLY_CONNECTED_STATUS
    : connectedCount === values.length
      ? "connected"
      : connectedCount > 0
        ? "partially_connected"
        : tokenIsExpired
          ? "token_expired"
          : explicitlyMissing.length
            ? "missing_permissions"
            : permissionUnknown
              ? "permissions_unknown"
              : persistedPermissionsSaved
                ? "partially_connected"
                : "missing_permissions";
  if (setupCompletion.complete && (config.status !== META_FULLY_CONNECTED_STATUS || config.webhook_enabled !== true)) {
    console.log("[meta-setup] overall_status transition", {
      tenant_id: numberOrNull(tenantId),
      source: "capabilities",
      webhook_verified: setupCompletion.webhook_verified,
      webhook_enabled: setupCompletion.webhook_enabled,
      subscribed_apps_verified: setupCompletion.subscribed_apps_verified,
      operational_messaging_verified: setupCompletion.operational_messaging_verified,
      overall_status_transition: `${config.status || "unknown"} -> ${META_FULLY_CONNECTED_STATUS}`,
    });
    await updateCapabilityStatus({
      tenantId,
      capabilityStatus: refreshedCapabilityStatus,
      status: nextStatus,
    }).catch(() => {});
  }
  return {
    status: nextStatus,
    permissions: {
      ...permissions,
      granted: effectiveGranted,
      permissions_saved: setupCompletion.permissions_saved,
      permissions_status: permissionUnknown && !persistedPermissionsSaved ? "permissions_unknown" : explicitlyMissing.length ? "missing_permissions" : "connected",
      missing_permissions: explicitlyMissing,
    },
    capabilities,
    setup_completion: setupCompletion,
  };
};

export const getMetaHealth = async ({ tenantId, req = null } = {}) => {
  const status = await getMetaIntegrationStatus({ tenantId, req });
  const [capabilities, webhook] = await Promise.all([
    getMetaCapabilities({ tenantId, req, live: true }),
    getMetaWebhookHealth({ tenantId, req }),
  ]);
  const config = status.config || {};
  const refreshedCapabilityStatus = mergeCapabilityStatus(
    config.capability_status,
    capabilityStatusFromPublicCapabilities(capabilities.capabilities)
  );
  const expirationSeconds = secondsUntil(config.token_expires_at);
  const tokenAgeDays = daysBetween(config.token_last_validated_at || config.last_sync_at);
  const setupCompletion = evaluateMetaSetupCompletion({
    config: {
      ...config,
      capability_status: refreshedCapabilityStatus,
    },
    permissions: capabilities.permissions,
    webhookSubscription: {
      ...(webhook.subscribed_apps || {}),
      webhook_verified: webhook.webhook_verified,
      webhook_enabled: webhook.webhook_enabled,
    },
  });
  const overallStatus = setupCompletion.complete ? META_FULLY_CONNECTED_STATUS : capabilities.status;
  if (setupCompletion.complete && config.status !== META_FULLY_CONNECTED_STATUS) {
    console.log("[meta-setup] overall_status transition", {
      tenant_id: numberOrNull(tenantId),
      source: "health",
      webhook_verified: setupCompletion.webhook_verified,
      webhook_enabled: setupCompletion.webhook_enabled,
      subscribed_fields: setupCompletion.subscribed_fields,
      subscribed_apps_verified: setupCompletion.subscribed_apps_verified,
      operational_messaging_verified: setupCompletion.operational_messaging_verified,
      overall_status_transition: `${config.status || "unknown"} -> ${META_FULLY_CONNECTED_STATUS}`,
    });
    await db.query(
      `
      UPDATE meta_integration_configs
      SET status = $2,
          webhook_enabled = TRUE,
          webhook_verified = TRUE,
          subscribed_apps_verified = TRUE,
          capability_status = $3::jsonb,
          updated_at = NOW()
      WHERE tenant_id = $1
      `,
      [numberOrNull(tenantId), META_FULLY_CONNECTED_STATUS, json(refreshedCapabilityStatus)]
    ).catch(() => {});
  } else {
    console.log("[meta-setup] completion evaluation", {
      tenant_id: numberOrNull(tenantId),
      source: "health",
      webhook_verified: setupCompletion.webhook_verified,
      webhook_enabled: setupCompletion.webhook_enabled,
      subscribed_fields: setupCompletion.subscribed_fields,
      subscribed_apps_verified: setupCompletion.subscribed_apps_verified,
      operational_messaging_verified: setupCompletion.operational_messaging_verified,
      overall_status: overallStatus,
    });
  }
  return {
    overall_status: overallStatus,
    checked_at: nowIso(),
    config,
    checklist: status.checklist,
    setup_completion: setupCompletion,
    channels: status.channels,
    capabilities: capabilities.capabilities,
    webhook,
    token: {
      status: config.token_health_status || config.token_status,
      age_days: tokenAgeDays,
      expires_at: config.token_expires_at,
      expiration_countdown_seconds: expirationSeconds,
      last_checked_at: config.token_last_validated_at,
      last_refresh_at: config.last_auto_refresh_at,
      next_refresh_check_at: config.next_refresh_check_at,
      last_refresh_status: config.last_auto_refresh_at ? "success" : "not_run",
      auto_refresh_enabled: Boolean(config.auto_refresh_enabled),
      auto_refresh_success_rate: config.last_auto_refresh_at ? 100 : 0,
    },
  };
};

export const getMetaSetupCheck = async ({ req = null } = {}) => {
  const env = setupEnvStatus(req);
  const webhookUrl = `${env.backend_url || ""}/api/meta/webhook`;
  const oauthStartUrl = `${env.backend_url || ""}/api/meta/oauth/start`;
  const isLocalhost = /localhost|127\.0\.0\.1/i.test(`${env.redirect_uri} ${webhookUrl} ${env.frontend_url}`);
  return {
    env_ready: env.missing_env_vars.length === 0,
    missing_env_vars: env.missing_env_vars,
    env: {
      META_APP_ID: env.required.META_APP_ID ? "present" : "missing",
      META_APP_SECRET: env.required.META_APP_SECRET ? "present" : "missing",
      META_REDIRECT_URI: env.required.META_REDIRECT_URI ? "present" : "missing",
      META_VERIFY_TOKEN: env.required.META_VERIFY_TOKEN ? "present" : "missing",
    },
    redirect_uri: env.redirect_uri,
    webhook_url: webhookUrl,
    oauth_start_url: oauthStartUrl,
    frontend_url: env.frontend_url,
    verify_token_status: env.required.META_VERIFY_TOKEN ? "configured" : "missing",
    required_permissions: META_OAUTH_SCOPES,
    app_mode_hint: isLocalhost
      ? "Localhost detected. Meta webhooks require HTTPS. Use the configured Cloudflare Tunnel URL for webhook testing; ngrok is only an optional fallback."
      : "Use Live mode after permissions are approved in Meta App Review.",
    setup_steps: [
      "Create or open your Meta app.",
      "Add Facebook Login and configure the OAuth redirect URI exactly.",
      "Add Webhooks and paste the webhook callback URL.",
      "Set the verify token to the same value as META_VERIFY_TOKEN.",
      "Keep the Cloudflare Tunnel running and pointed at the backend port.",
      "Request required permissions in Meta App Review for production use.",
      "Return to Marketing Settings and click Connect Meta.",
    ],
  };
};

export const startMetaOAuth = async ({ tenantId, userId = null, req = null } = {}) => {
  await ensureMetaIntegrationSchema();
  assertMetaOAuthConfig(req);
  const state = crypto.randomBytes(32).toString("hex");
  await db.query(
    `
    INSERT INTO meta_oauth_states (tenant_id, user_id, state_token, status, expires_at)
    VALUES ($1,$2,$3,'started',$4::timestamp)
    `,
    [numberOrNull(tenantId), numberOrNull(userId), state, minutesFromNow(15)]
  );
  return {
    state,
    auth_url: oauthDialogUrl({ state, req }),
    expires_at: minutesFromNow(15),
  };
};

const callbackHtml = ({ origin = "", payload = {} }) => {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const targetOrigin = origin || "*";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Meta OAuth</title></head>
<body style="font-family:system-ui;background:#060816;color:white;padding:24px">
<h1>Meta connection ${payload.success ? "complete" : "failed"}</h1>
<p>${payload.message || ""}</p>
<script>
  const payload = ${safePayload};
  if (window.opener) {
    window.opener.postMessage({ type: "meta-oauth", payload }, ${JSON.stringify(targetOrigin)});
    window.close();
  }
</script>
</body></html>`;
};

export const completeMetaOAuthCallback = async ({ code = "", state = "", error = "", errorDescription = "", req = null } = {}) => {
  await ensureMetaIntegrationSchema();
  const origin = frontendOriginFor(req);
  const stateToken = text(state);
  console.log("[meta-oauth] meta_oauth_callback_received", {
    state_present: Boolean(stateToken),
    code_present: Boolean(text(code)),
    error: text(error),
  });
  if (error) {
    return callbackHtml({ origin, payload: { success: false, status: "refused", message: text(errorDescription) || "Meta permissions were refused." } });
  }
  if (!stateToken || !text(code)) {
    return callbackHtml({ origin, payload: { success: false, status: "invalid_request", message: "Meta OAuth callback was missing code or state." } });
  }
  const stateResult = await db.query(
    `
    SELECT *
    FROM meta_oauth_states
    WHERE state_token = $1
      AND expires_at > NOW()
      AND status = 'started'
    LIMIT 1
    `,
    [stateToken]
  );
  const stateRow = stateResult.rows[0];
  if (!stateRow) {
    return callbackHtml({ origin, payload: { success: false, status: "invalid_state", message: "Meta OAuth state is invalid or expired." } });
  }
  try {
    const tokenResult = await exchangeOAuthCode({ code: text(code), req });
    const pages = await fetchManagedPages({ userToken: tokenResult.longLivedUserToken });
    console.log("[meta-oauth] callback pages fetched", {
      tenant_id: stateRow.tenant_id,
      page_count: pages.length,
      page_ids: pages.map((page) => maskIdForLog(page.page_id)),
    });
    if (!pages.length) throw Object.assign(new Error("Meta did not return any managed Facebook Pages for this user."), { status: 400 });
    await db.query(
      `
      UPDATE meta_oauth_states
      SET long_lived_user_token_encrypted = $2,
          pending_pages = $3::jsonb,
          status = $4,
          updated_at = NOW()
      WHERE id = $1
      `,
      [
        stateRow.id,
        encryptSecret(tokenResult.longLivedUserToken),
        json(pages),
        pages.length === 1 ? "selecting" : "pages_ready",
      ]
    );
    if (pages.length === 1) {
      await selectMetaOAuthPage({
        tenantId: stateRow.tenant_id,
        userId: stateRow.user_id,
        pageId: pages[0].page_id,
        stateId: stateRow.id,
        tokenExpiresAt: tokenResult.tokenExpiresAt,
      });
      return callbackHtml({ origin, payload: { success: true, status: "connected", message: "Meta Page connected.", page_count: 1 } });
    }
    return callbackHtml({ origin, payload: { success: true, status: "pages_ready", message: "Choose a Facebook Page to complete setup.", page_count: pages.length } });
  } catch (callbackError) {
    await db.query(
      `UPDATE meta_oauth_states SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
      [stateRow.id, callbackError?.message || "Meta OAuth callback failed"]
    ).catch(() => {});
    return callbackHtml({ origin, payload: { success: false, status: "failed", message: callbackError?.message || "Meta OAuth callback failed" } });
  }
};

export const getMetaOAuthPages = async ({ tenantId, userId = null } = {}) => {
  await ensureMetaIntegrationSchema();
  const result = await db.query(
    `
    SELECT id, pending_pages, status, error_message, created_at, updated_at
    FROM meta_oauth_states
    WHERE tenant_id = $1
      AND ($2::bigint IS NULL OR user_id = $2)
      AND status IN ('pages_ready','selecting','selected','failed')
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [numberOrNull(tenantId), numberOrNull(userId)]
  );
  const row = result.rows[0] || null;
  const pages = Array.isArray(row?.pending_pages) ? row.pending_pages : [];
  return {
    status: row?.status || "empty",
    error_message: row?.error_message || "",
    pages: pages.map(publicOAuthPage),
    updated_at: row?.updated_at || null,
  };
};

export const getMetaIntegrationDebugConfigs = async ({ tenantId = null } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const result = await db.query(
    `
    SELECT id, tenant_id, facebook_page_id, instagram_business_account_id, page_name,
           webhook_enabled, webhook_verified, subscribed_apps_verified, permissions_saved, messenger_enabled,
           instagram_dm_enabled, status, token_expires_at, created_at, updated_at,
           page_access_token_encrypted <> '' AS page_access_token_saved
    FROM meta_integration_configs
    WHERE ($1::bigint IS NULL OR tenant_id = $1)
    ORDER BY updated_at DESC
    LIMIT 50
    `,
    [scopedTenantId]
  );
  const configs = result.rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    facebook_page_id: maskIdForLog(row.facebook_page_id),
    instagram_business_account_id: maskIdForLog(row.instagram_business_account_id),
    page_name: row.page_name || "",
    page_access_token_saved: row.page_access_token_saved === true,
    webhook_enabled: row.webhook_enabled === true,
    webhook_verified: row.webhook_verified === true,
    subscribed_apps_verified: row.subscribed_apps_verified === true,
    permissions_saved: row.permissions_saved === true,
    messenger_enabled: row.messenger_enabled === true,
    instagram_dm_enabled: row.instagram_dm_enabled === true,
    status: row.status || "",
    token_expires_at: row.token_expires_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
  console.log("[meta-integration] debug configs", {
    tenant_id: scopedTenantId,
    count: configs.length,
    configs,
  });
  return { count: configs.length, configs };
};

export const getMetaIntegrationRawDebugConfigs = async ({ tenantId = null } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const result = await db.query(
    `
    SELECT id, tenant_id, facebook_page_id, instagram_business_account_id,
           webhook_enabled, webhook_verified, subscribed_apps_verified, permissions_saved,
           status, created_at, updated_at
    FROM meta_integration_configs
    WHERE ($1::bigint IS NULL OR tenant_id = $1)
    ORDER BY updated_at DESC
    LIMIT 100
    `,
    [scopedTenantId]
  );
  console.log("[meta-integration] raw configs debug", {
    tenant_id: scopedTenantId,
    row_count: result.rows.length,
    ids: result.rows.map((row) => row.id),
  });
  return {
    row_count: result.rows.length,
    ids: result.rows.map((row) => row.id),
    rows: result.rows.map((row) => ({
      ...row,
      facebook_page_id: maskIdForLog(row.facebook_page_id),
      instagram_business_account_id: maskIdForLog(row.instagram_business_account_id),
    })),
  };
};

export const selectMetaOAuthPage = async ({ tenantId, userId = null, pageId = "", stateId = null, tokenExpiresAt = null } = {}) => {
  await ensureMetaIntegrationSchema();
  const params = stateId
    ? [numberOrNull(stateId), numberOrNull(tenantId), null]
    : [null, numberOrNull(tenantId), numberOrNull(userId)];
  const stateResult = await db.query(
    `
    SELECT *
    FROM meta_oauth_states
    WHERE (($1::bigint IS NOT NULL AND id = $1) OR ($1::bigint IS NULL AND tenant_id = $2 AND ($3::bigint IS NULL OR user_id = $3)))
      AND status IN ('pages_ready','selecting')
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    params
  );
  const row = stateResult.rows[0];
  if (!row) throw Object.assign(new Error("No pending Meta OAuth page selection was found."), { status: 404 });
  const pages = Array.isArray(row.pending_pages) ? row.pending_pages : [];
  const requestedPageId = text(pageId);
  const selected = pages.find((page) => text(page.page_id) === requestedPageId) || (pages.length === 1 ? pages[0] : null);
  if (!selected) throw Object.assign(new Error("Selected Facebook Page is not available in the OAuth result."), { status: 400 });
  const longLivedUserToken = decryptSecret(row.long_lived_user_token_encrypted);
  const pageAccessToken = decryptSecret(selected.page_access_token_encrypted);
  const scopedTenantId = numberOrNull(tenantId || row.tenant_id);
  const selectedPageId = text(selected.page_id);
  const selectedIgId = text(selected.instagram_business_account_id);
  console.log("[meta-oauth] meta_page_selected", {
    tenant_id: scopedTenantId,
    state_id: row.id,
    facebook_page_id: maskIdForLog(selectedPageId),
    instagram_business_account_id: maskIdForLog(selectedIgId),
    page_access_token_present: Boolean(pageAccessToken),
  });
  if (!selectedPageId) throw Object.assign(new Error("Selected Facebook Page ID is empty."), { status: 400 });
  if (!pageAccessToken) throw Object.assign(new Error("Selected Facebook Page access token is missing."), { status: 400 });
  await db.query(
    `
    INSERT INTO marketing_settings (
      tenant_id, provider, page_id, instagram_account_id, access_token_encrypted,
      long_lived_user_token, page_access_token, token_expires_at, token_status,
      token_last_validated_at, is_connected, next_refresh_check_at, updated_at
    )
    VALUES ($1,'meta',$2,$3,$4,$5,$4,$6::timestamp,'active',CURRENT_TIMESTAMP,TRUE,CURRENT_TIMESTAMP + INTERVAL '24 hours',CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id) DO UPDATE SET
      provider = 'meta',
      page_id = EXCLUDED.page_id,
      instagram_account_id = EXCLUDED.instagram_account_id,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      long_lived_user_token = EXCLUDED.long_lived_user_token,
      page_access_token = EXCLUDED.page_access_token,
      token_expires_at = EXCLUDED.token_expires_at,
      token_status = 'active',
      token_last_validated_at = CURRENT_TIMESTAMP,
      token_error_message = NULL,
      is_connected = TRUE,
      next_refresh_check_at = CURRENT_TIMESTAMP + INTERVAL '24 hours',
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      scopedTenantId,
      selectedPageId,
      selectedIgId,
      pageAccessToken,
      longLivedUserToken,
      tokenExpiresAt || null,
    ]
  );
  await saveMetaIntegrationConfig({
    tenantId: scopedTenantId,
    data: {
      facebook_page_id: selectedPageId,
      facebook_page_name: selected.page_name,
      page_access_token: pageAccessToken,
      instagram_business_account_id: selectedIgId,
      instagram_username: selected.instagram_username,
      messenger_enabled: true,
      instagram_dm_enabled: Boolean(selectedIgId),
      facebook_publishing_enabled: true,
      instagram_publishing_enabled: Boolean(selectedIgId),
      webhook_enabled: Boolean(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN),
      token_expires_at: tokenExpiresAt || null,
    },
  });
  const webhookSubscription = await subscribeMetaPageToWebhooks({
    tenantId: scopedTenantId,
    pageId: selectedPageId,
    pageAccessToken,
  }).catch((error) => ({
    page_id: selected.page_id,
    subscribed_apps_status: "failed",
    webhook_subscription_status: "failed",
    webhook_verification_status: "failed",
    webhook_enabled: false,
    webhook_verified: false,
    error: error?.message || "Unable to subscribe Facebook Page to app webhooks",
  }));
  const capabilities = await getMetaCapabilities({ tenantId: scopedTenantId, live: true }).catch(() => null);
  if (capabilities?.capabilities) {
    const capabilityStatus = Object.fromEntries(Object.entries(capabilities.capabilities).map(([key, value]) => [key, {
      ok: value.connected === true,
      status: value.status,
      missing_permissions: value.missing_permissions || [],
      checked_at: value.last_checked_at || nowIso(),
    }]));
    await updateCapabilityStatus({ tenantId: scopedTenantId, capabilityStatus, status: capabilities.status === "connected" ? "active" : "partial" });
  }
  await db.query(
    `
    UPDATE meta_oauth_states
    SET selected_page_id = $2,
        status = 'selected',
        updated_at = NOW()
    WHERE id = $1
    `,
    [row.id, selectedPageId]
  );
  return {
    selected: publicOAuthPage(selected),
    subscribed_apps: webhookSubscription,
    webhook_subscription: webhookSubscription,
    capabilities,
  };
};

export const testMetaMessageCapability = async ({ tenantId, channel = "facebook", recipientId = "", message = "" } = {}) => {
  const row = await getMetaIntegrationConfig({ tenantId });
  if (!row) throw Object.assign(new Error("Meta integration is not configured"), { status: 404 });
  const token = getTokenForConfig(row);
  if (!token) throw Object.assign(new Error("Page access token is missing"), { status: 400 });
  if (!text(recipientId)) {
    const capabilities = await getMetaCapabilities({ tenantId, live: true });
    return {
      sent: false,
      dry_run: true,
      message: "Recipient ID was not provided. Capability permissions were verified only.",
      capability: channel === "instagram" ? capabilities.capabilities.instagram_dm : capabilities.capabilities.messenger,
    };
  }
  const result = await callMetaPost({
    endpoint: "/me/messages",
    token,
    body: {
      recipient: { id: text(recipientId) },
      messaging_type: "RESPONSE",
      message: { text: text(message) || "Meta integration test message" },
    },
  });
  await logChannelEvent({
    tenantId,
    channel: channel === "instagram" ? AI_AGENT_CHANNELS.INSTAGRAM : AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
    direction: "outbound",
    externalCustomerId: text(recipientId),
    messagePreview: text(message) || "Meta integration test message",
    status: "sent",
    metadata: { source: "meta_hub_test", result },
  }).catch(() => {});
  return { sent: true, result };
};

export const testMetaPublishCapability = async ({ tenantId, platform = "facebook" } = {}) => {
  const capabilities = await getMetaCapabilities({ tenantId, live: true });
  const key = platform === "instagram" ? "instagram_publishing" : "facebook_publishing";
  return {
    dry_run: true,
    published: false,
    message: "Publishing test verified token, account, and permissions without creating a public post.",
    capability: capabilities.capabilities[key],
  };
};

export const saveMetaIntegrationConfig = async ({ tenantId, data = {} } = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const facebookPageId = text(data.facebook_page_id || data.facebookPageId);
  const existing = await getRealMetaIntegrationConfig({ tenantId: scopedTenantId, facebookPageId });
  const instagramBusinessAccountId = text(data.instagram_business_account_id || data.instagramBusinessAccountId);
  const pageName = text(data.facebook_page_name || data.facebookPageName || data.page_name || data.pageName);
  const pageAccessToken = text(data.page_access_token || data.pageAccessToken);
  const existingEncryptedToken = text(existing?.page_access_token_encrypted);
  const appSecret = text(data.app_secret || data.appSecret);
  const verifyToken = text(data.verify_token || data.verifyToken || existing?.verify_token || crypto.randomBytes(18).toString("hex"));
  const tokenExpiresAt = text(data.token_expires_at || data.tokenExpiresAt || existing?.token_expires_at);
  if (!scopedTenantId) throw Object.assign(new Error("Tenant ID is required to save Meta integration config."), { status: 400 });
  if (!facebookPageId) throw Object.assign(new Error("Facebook Page ID is required to save Meta integration config."), { status: 400 });
  if (!pageAccessToken && !existingEncryptedToken) throw Object.assign(new Error("Facebook Page access token is required to save Meta integration config."), { status: 400 });
  const webhookEnabled = bool(data.webhook_enabled ?? data.webhookEnabled ?? true);
  const webhookVerified = bool(data.webhook_verified ?? data.webhookVerified ?? webhookEnabled);
  const subscribedAppsVerified = bool(data.subscribed_apps_verified ?? data.subscribedAppsVerified ?? webhookEnabled);
  const permissionsSaved = bool(data.permissions_saved ?? data.permissionsSaved ?? true);
  console.log("[meta-integration] meta_config_before_save", {
    tenant_id: scopedTenantId,
    facebook_page_id: maskIdForLog(facebookPageId),
    instagram_business_account_id: maskIdForLog(instagramBusinessAccountId),
    page_name_present: Boolean(pageName),
    page_access_token_present: Boolean(pageAccessToken || existingEncryptedToken),
    webhook_enabled: webhookEnabled,
    webhook_verified: webhookVerified,
    subscribed_apps_verified: subscribedAppsVerified,
    permissions_saved: permissionsSaved,
    existing_config_present: Boolean(existing?.tenant_id),
  });
  console.log("[meta-integration] meta_config_insert_attempt", {
    tenant_id: scopedTenantId,
    facebook_page_id: maskIdForLog(facebookPageId),
    has_existing_real_row: Boolean(existing?.id),
  });
  console.log("[meta-integration] meta_config_insert_payload", {
    tenant_id: scopedTenantId,
    facebook_page_id: maskIdForLog(facebookPageId),
    instagram_business_account_id: maskIdForLog(instagramBusinessAccountId),
    page_access_token_present: Boolean(pageAccessToken || existingEncryptedToken),
    webhook_enabled: webhookEnabled,
    webhook_verified: webhookVerified,
    subscribed_apps_verified: subscribedAppsVerified,
    permissions_saved: permissionsSaved,
    status: "active",
  });
  try {
    const result = await db.query(
    `
    INSERT INTO meta_integration_configs (
      tenant_id, facebook_page_id, page_name, facebook_page_name, page_access_token_encrypted,
      instagram_business_account_id, instagram_username, app_id, app_secret_encrypted, verify_token,
      webhook_enabled, webhook_verified, subscribed_apps_verified, permissions_saved, messenger_enabled, instagram_enabled, instagram_dm_enabled,
      facebook_publishing_enabled, instagram_publishing_enabled, token_expires_at, status, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NULLIF($20, '')::timestamp,$21,NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      facebook_page_id = EXCLUDED.facebook_page_id,
      page_name = EXCLUDED.page_name,
      facebook_page_name = EXCLUDED.facebook_page_name,
      page_access_token_encrypted = CASE WHEN EXCLUDED.page_access_token_encrypted <> '' THEN EXCLUDED.page_access_token_encrypted ELSE meta_integration_configs.page_access_token_encrypted END,
      instagram_business_account_id = EXCLUDED.instagram_business_account_id,
      instagram_username = EXCLUDED.instagram_username,
      app_id = EXCLUDED.app_id,
      app_secret_encrypted = CASE WHEN EXCLUDED.app_secret_encrypted <> '' THEN EXCLUDED.app_secret_encrypted ELSE meta_integration_configs.app_secret_encrypted END,
      verify_token = EXCLUDED.verify_token,
      webhook_enabled = EXCLUDED.webhook_enabled,
      webhook_verified = EXCLUDED.webhook_verified,
      subscribed_apps_verified = EXCLUDED.subscribed_apps_verified,
      permissions_saved = CASE WHEN EXCLUDED.permissions_saved = TRUE THEN TRUE ELSE meta_integration_configs.permissions_saved END,
      messenger_enabled = EXCLUDED.messenger_enabled,
      instagram_enabled = EXCLUDED.instagram_enabled,
      instagram_dm_enabled = EXCLUDED.instagram_dm_enabled,
      facebook_publishing_enabled = EXCLUDED.facebook_publishing_enabled,
      instagram_publishing_enabled = EXCLUDED.instagram_publishing_enabled,
      token_expires_at = COALESCE(EXCLUDED.token_expires_at, meta_integration_configs.token_expires_at),
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING *
    `,
    [
      scopedTenantId,
      facebookPageId,
      pageName,
      pageName,
      pageAccessToken ? encryptSecret(pageAccessToken) : "",
      instagramBusinessAccountId,
      text(data.instagram_username || data.instagramUsername),
      text(data.app_id || data.appId),
      appSecret ? encryptSecret(appSecret) : "",
      verifyToken,
      webhookEnabled,
      webhookVerified,
      subscribedAppsVerified,
      permissionsSaved,
      bool(data.messenger_enabled ?? data.messengerEnabled),
      bool(data.instagram_enabled ?? data.instagramEnabled ?? data.instagram_dm_enabled ?? data.instagramDmEnabled),
      bool(data.instagram_dm_enabled ?? data.instagramDmEnabled ?? data.instagram_enabled ?? data.instagramEnabled),
      bool(data.facebook_publishing_enabled ?? data.facebookPublishingEnabled),
      bool(data.instagram_publishing_enabled ?? data.instagramPublishingEnabled),
      tokenExpiresAt,
      "active",
    ]
  );
  const saved = result.rows[0];
  console.log("[meta-integration] meta_config_upsert_result", {
    tenant_id: scopedTenantId,
    config_id: saved?.id || null,
    facebook_page_id: maskIdForLog(saved?.facebook_page_id),
    status: saved?.status || "",
  });
  const verify = await db.query(
    `
    SELECT id, tenant_id, facebook_page_id, instagram_business_account_id, webhook_enabled, webhook_verified, subscribed_apps_verified, permissions_saved, status
    FROM meta_integration_configs
    WHERE tenant_id = $1 AND TRIM(facebook_page_id::text) = $2
    LIMIT 1
    `,
    [scopedTenantId, facebookPageId]
  );
  console.log("[meta-integration] meta_config_post_save_lookup", {
    tenant_id: scopedTenantId,
    facebook_page_id: maskIdForLog(facebookPageId),
    rows: verify.rows.length,
    config_id: verify.rows[0]?.id || null,
  });
  if (!verify.rows[0]) {
    throw Object.assign(new Error("Meta integration config upsert did not persist a readable row."), { status: 500 });
  }
  console.log("[meta-integration] meta_config_saved", {
    config_id: saved?.id || null,
    tenant_id: saved?.tenant_id || scopedTenantId,
    facebook_page_id: maskIdForLog(saved?.facebook_page_id),
    instagram_business_account_id: maskIdForLog(saved?.instagram_business_account_id),
    webhook_enabled: saved?.webhook_enabled === true,
    webhook_verified: saved?.webhook_verified === true,
    subscribed_apps_verified: saved?.subscribed_apps_verified === true,
    permissions_saved: saved?.permissions_saved === true,
    status: saved?.status || "",
    verified_after_save: Boolean(verify.rows[0]),
  });
  console.log("[meta-integration] meta_config_insert_success", {
    tenant_id: scopedTenantId,
    config_id: saved?.id || null,
    facebook_page_id: maskIdForLog(saved?.facebook_page_id),
  });
  console.log("[meta-integration] config saved", {
    tenant_id: scopedTenantId,
    facebook_page_id: facebookPageId,
    instagram_configured: Boolean(instagramBusinessAccountId),
    token_saved: Boolean(pageAccessToken || existing?.page_access_token_encrypted),
  });
  await repairDuplicateMetaConfigsForPage({ facebookPageId }).catch((repairError) => {
    console.warn("[meta-integration] duplicate config repair failed", {
      facebook_page_id: maskIdForLog(facebookPageId),
      message: repairError?.message || "unknown",
    });
  });
  return sanitizeConfig(saved);
  } catch (error) {
    console.error("[meta-integration] meta_config_save_failed", {
      tenant_id: scopedTenantId,
      facebook_page_id: maskIdForLog(facebookPageId),
      instagram_business_account_id: maskIdForLog(instagramBusinessAccountId),
      message: error?.message || "unknown",
      code: error?.code || "",
    });
    console.error("[meta-integration] meta_config_insert_failed", {
      tenant_id: scopedTenantId,
      facebook_page_id: maskIdForLog(facebookPageId),
      message: error?.message || "unknown",
      code: error?.code || "",
    });
    throw error;
  }
};

export const testMetaIntegrationConfig = async ({ tenantId } = {}) => {
  const row = await getMetaIntegrationConfig({ tenantId });
  if (!row) throw Object.assign(new Error("Meta integration is not configured"), { status: 404 });
  const token = decryptSecret(row.page_access_token_encrypted);
  if (!token || !row.facebook_page_id) throw Object.assign(new Error("Facebook Page ID and Page Access Token are required"), { status: 400 });
  const target = new URL(`${GRAPH_BASE_URL}/${encodeURIComponent(row.facebook_page_id)}`);
  target.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
  target.searchParams.set("access_token", token);
  const safeUrl = target.toString().replace(/access_token=[^&]+/g, "access_token=***");
  console.log("[meta-integration] test request", { tenant_id: tenantId, target: safeUrl });
  const response = await fetch(target);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    await db.query(`UPDATE meta_integration_configs SET status = 'invalid', last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`, [numberOrNull(tenantId)]);
    throw Object.assign(new Error(payload?.error?.message || "Meta connection test failed"), { status: response.status, meta: payload?.error || null });
  }
  const pageName = text(payload.name || row.page_name);
  const igId = text(payload.instagram_business_account?.id || row.instagram_business_account_id);
  const result = await db.query(
    `
    UPDATE meta_integration_configs
    SET page_name = $2,
        instagram_business_account_id = COALESCE(NULLIF($3, ''), instagram_business_account_id),
        status = 'active',
        last_sync_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING *
    `,
    [numberOrNull(tenantId), pageName, igId]
  );
  return { config: sanitizeConfig(result.rows[0]), meta: { id: payload.id || "", name: pageName, instagram_business_account_id: igId } };
};

export const findMetaConfigForWebhookVerification = async ({ verifyToken } = {}) => {
  await ensureMetaIntegrationSchema();
  const result = await db.query(
    `SELECT * FROM meta_integration_configs WHERE verify_token = $1 AND webhook_enabled = TRUE ORDER BY updated_at DESC LIMIT 1`,
    [text(verifyToken)]
  );
  return result.rows[0] || null;
};

const repairMetaWebhookEnabledForConfig = async (row = {}) => {
  const existingCapabilityStatus = row.capability_status && typeof row.capability_status === "object" ? row.capability_status : {};
  const nextCapabilityStatus = {
    ...existingCapabilityStatus,
    webhook: {
      ...(existingCapabilityStatus.webhook || {}),
      ok: true,
      status: "connected",
      checked_at: nowIso(),
      subscribed_apps: {
        ...((existingCapabilityStatus.webhook || {}).subscribed_apps || {}),
        webhook_enabled: true,
        webhook_verified: true,
        subscribed_apps_verified: true,
        subscribed_apps_status: "subscribed",
        webhook_subscription_status: "subscribed",
        repaired_from_live_delivery: true,
        checked_at: nowIso(),
      },
    },
  };
  const result = await db.query(
    `
    UPDATE meta_integration_configs
    SET webhook_enabled = TRUE,
        webhook_verified = TRUE,
        subscribed_apps_verified = TRUE,
        permissions_saved = TRUE,
        capability_status = $2::jsonb,
        status = CASE
          WHEN status IN ('fully_connected','active','connected','saved') THEN status
          ELSE 'active'
        END,
        last_sync_at = NOW(),
        updated_at = NOW()
    WHERE tenant_id = $1
    RETURNING *
    `,
    [numberOrNull(row.tenant_id), json(nextCapabilityStatus)]
  );
  return result.rows[0] || { ...row, webhook_enabled: true, capability_status: nextCapabilityStatus };
};

const logMetaWebhookNoConfig = async ({ pageId = "", instagramBusinessAccountId = "", strictRows = 0, fallbackRows = 0 } = {}) => {
  const known = await db.query(
    `
    SELECT id, tenant_id, facebook_page_id, instagram_business_account_id, webhook_enabled, status, updated_at
    FROM meta_integration_configs
    WHERE COALESCE(facebook_page_id, '') <> ''
       OR COALESCE(instagram_business_account_id, '') <> ''
    ORDER BY updated_at DESC
    LIMIT 10
    `
  ).catch(() => ({ rows: [] }));
  console.warn("[meta-webhook] webhook_no_config", {
    incoming_facebook_page_id: maskIdForLog(pageId),
    incoming_instagram_business_account_id: maskIdForLog(instagramBusinessAccountId),
    strict_rows: strictRows,
    fallback_rows: fallbackRows,
    known_configs: (known.rows || []).map((row) => ({
      config_id: row.id || null,
      tenant_id: row.tenant_id || null,
      facebook_page_id: maskIdForLog(row.facebook_page_id),
      instagram_business_account_id: maskIdForLog(row.instagram_business_account_id),
      webhook_enabled: row.webhook_enabled === true,
      status: row.status || "",
    })),
  });
};

export const findMetaConfigForAccount = async ({ pageId = "", instagramBusinessAccountId = "" } = {}) => {
  await ensureMetaIntegrationSchema();
  const page = text(pageId);
  const ig = text(instagramBusinessAccountId);
  const strict = await db.query(
    `
    SELECT *
    FROM meta_integration_configs
    WHERE webhook_enabled = TRUE
      AND (
        NULLIF($1::text, '') IS NOT NULL AND TRIM(facebook_page_id::text) = $1
        OR NULLIF($2::text, '') IS NOT NULL AND TRIM(instagram_business_account_id::text) = $2
      )
    ORDER BY updated_at DESC
    `,
    [page, ig]
  );
  if (strict.rows[0]) {
    console.log("[meta-webhook] config lookup", {
      incoming_facebook_page_id: maskIdForLog(page),
      incoming_instagram_business_account_id: maskIdForLog(ig),
      strict_rows: strict.rows.length,
      fallback_rows: 0,
      match_mode: "strict",
      matched_config_id: strict.rows[0]?.id || null,
      matched_tenant_id: strict.rows[0]?.tenant_id || null,
      webhook_enabled_before: strict.rows[0]?.webhook_enabled === true,
      webhook_enabled_after: true,
    });
    return strict.rows[0];
  }

  const fallback = await db.query(
    `
    SELECT *
    FROM meta_integration_configs
    WHERE (
        NULLIF($1::text, '') IS NOT NULL AND TRIM(facebook_page_id::text) = $1
        OR NULLIF($2::text, '') IS NOT NULL AND TRIM(instagram_business_account_id::text) = $2
      )
      AND page_access_token_encrypted IS NOT NULL
      AND page_access_token_encrypted <> ''
      AND COALESCE(token_expires_at, NOW() + INTERVAL '1 day') > NOW()
      AND LOWER(COALESCE(status, '')) NOT IN ('invalid','token_expired','revoked','error')
    ORDER BY updated_at DESC
    `,
    [page, ig]
  );
  if (fallback.rows.length === 1) {
    const row = fallback.rows[0];
    const repaired = await repairMetaWebhookEnabledForConfig(row).catch((error) => {
      console.warn("[meta-webhook] webhook_enabled repair failed", {
        matched_config_id: row?.id || null,
        matched_tenant_id: row?.tenant_id || null,
        message: error?.message || "unknown",
      });
      return row;
    });
    console.log("[meta-webhook] config lookup", {
      incoming_facebook_page_id: maskIdForLog(page),
      incoming_instagram_business_account_id: maskIdForLog(ig),
      strict_rows: strict.rows.length,
      fallback_rows: fallback.rows.length,
      match_mode: "fallback_repaired",
      matched_config_id: row?.id || null,
      matched_tenant_id: row?.tenant_id || null,
      webhook_enabled_before: row?.webhook_enabled === true,
      webhook_enabled_after: repaired?.webhook_enabled === true,
    });
    return repaired || row;
  }

  await logMetaWebhookNoConfig({ pageId: page, instagramBusinessAccountId: ig, strictRows: strict.rows.length, fallbackRows: fallback.rows.length });
  return null;
};

const webhookAccountIdsFromBody = (body = {}) => {
  const pageIds = new Set();
  const instagramIds = new Set();
  const addByObject = (value) => {
    const safe = text(value);
    if (!safe) return;
    if (body.object === "instagram") instagramIds.add(safe);
    else pageIds.add(safe);
  };
  (Array.isArray(body.entry) ? body.entry : []).forEach((entry) => {
    if (entry?.id) addByObject(entry.id);
    (Array.isArray(entry?.messaging) ? entry.messaging : []).forEach((event) => {
      if (event?.recipient?.id) addByObject(event.recipient.id);
      if (event?.recipient?.id && body.object === "page") pageIds.add(text(event.recipient.id));
      if (event?.recipient?.id && body.object === "instagram") instagramIds.add(text(event.recipient.id));
      if (event?.postback?.recipient?.id) addByObject(event.postback.recipient.id);
    });
    (Array.isArray(entry?.changes) ? entry.changes : []).forEach((change) => {
      if (change?.value?.page_id) pageIds.add(text(change.value.page_id));
      if (change?.value?.from?.id && body.object === "instagram") instagramIds.add(text(change.value.from.id));
      if (change?.value?.recipient_id) addByObject(change.value.recipient_id);
    });
  });
  return {
    pageIds: [...pageIds].map(text).filter(Boolean),
    instagramBusinessAccountIds: [...instagramIds].map(text).filter(Boolean),
  };
};

const logIncomingToInbox = async ({ message, config }) => {
  await ensureAiSupportLogSchema();
  const sessionId = message.external_conversation_id;
  const channel = channelAlias(message.channel);
  const customerName = text(message.customer_name);
  const lastMessage = text(message.message_text) || "[attachment]";
  const externalMessageId = text(message.external_message_id || message.raw?.event?.message?.mid || message.raw?.event?.message?.id);
  const dedupeKey = text(message.dedupe_key) || crypto
    .createHash("sha256")
    .update([config.tenant_id, sessionId, channel, externalMessageId || message.external_customer_id, message.timestamp, lastMessage].map(text).join("|"))
    .digest("hex");
  console.log("[meta-inbox] meta_inbox_session_upsert_start", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    source: channel,
    channel,
    external_customer_id: message.external_customer_id,
    sender_psid: message.raw?.sender_psid || message.external_customer_id || "",
    customer_psid: message.raw?.customer_psid || message.external_customer_id || "",
    resolved_sender_id: message.raw?.sender_psid || message.external_customer_id || "",
    resolved_customer_id: message.external_customer_id || "",
    resolved_page_id: message.raw?.page_id || "",
    external_message_id: externalMessageId || null,
    dedupe_key: dedupeKey,
  });
  const session = await db.query(
    `
    INSERT INTO ai_support_sessions (tenant_id, session_id, source, channel, customer_name, last_message, updated_at)
    VALUES ($1,$2,$3::text,$4::text,$5::text,$6::text,NOW())
    ON CONFLICT (tenant_id, session_id) DO UPDATE SET
      source = EXCLUDED.source,
      channel = EXCLUDED.channel,
      customer_name = COALESCE(NULLIF(EXCLUDED.customer_name, ''), ai_support_sessions.customer_name),
      last_message = EXCLUDED.last_message,
      updated_at = NOW()
    RETURNING id
    `,
    [config.tenant_id, sessionId, channel, channel, customerName, lastMessage]
  );
  console.log("[meta-inbox] meta_inbox_session_upsert_success", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    session_ref_id: session.rows[0]?.id || null,
  });
  const inserted = await db.query(
    `
    INSERT INTO ai_support_messages (
      session_ref_id, tenant_id, session_id, channel, customer_name, last_message, message_text,
      customer_message, ai_answer, confidence, needs_human_support, sources_used, suggested_products,
      visual_attachments, suggested_actions, detected_intent, fallback_reason, sender_type, external_message_id, dedupe_key
    )
    VALUES ($1,$2,$3::text,$4::text,$5::text,$6::text,$6::text,$6::text,'',0,FALSE,'[]'::jsonb,'[]'::jsonb,$7::jsonb,'[]'::jsonb,'','ai_status:pending','customer',$8,$9)
    ON CONFLICT (tenant_id, session_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
    RETURNING *
    `,
    [session.rows[0]?.id || null, config.tenant_id, sessionId, channel, customerName, lastMessage, json(message.attachments || []), externalMessageId, dedupeKey]
  );
  if (!inserted.rows[0]) {
    console.log("[meta-inbox] meta_message_duplicate_skipped", {
      tenant_id: config.tenant_id,
      session_id: sessionId,
      external_message_id: externalMessageId || null,
      dedupe_key: dedupeKey,
    });
    return { duplicate: true, session_id: sessionId, dedupe_key: dedupeKey };
  }
  console.log("[meta-inbox] meta_inbox_message_insert_success", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    message_id: inserted.rows[0]?.id || null,
  });
  emitToRooms([`tenant:${config.tenant_id}`], "ai_inbox:message", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    message: inserted.rows[0] || null,
    at: nowIso(),
  });
  emitToRooms([`tenant:${config.tenant_id}`], "ai_inbox:refresh", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    at: nowIso(),
  });
  console.log("[meta-inbox] meta_inbox_socket_emit", {
    tenant_id: config.tenant_id,
    session_id: sessionId,
    events: ["ai_inbox:message", "ai_inbox:refresh"],
  });
  return { duplicate: false, session_id: sessionId, message: inserted.rows[0] || null, dedupe_key: dedupeKey };
};

const routeMessageThroughAi = async ({ req, message, config }) => {
  const channel = channelAlias(message.channel);
  const response = await fetch(`${text(process.env.INTERNAL_AI_SUPPORT_URL) || `${req.protocol || "http"}://${req.get("host")}`}/api/ai-support/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-tenant-id": String(config.tenant_id) },
    body: json({
      tenant_id: config.tenant_id,
      message: message.message_text || "Customer sent an attachment",
      session_id: message.external_conversation_id,
      channel: message.channel,
      metadata: {
        session_id: message.external_conversation_id,
        customer_id: message.external_customer_id,
        customer_name: message.customer_name,
        channel,
        adapter_channel: message.channel,
        external_conversation_id: message.external_conversation_id,
        external_customer_id: message.external_customer_id,
        attachments: message.attachments || [],
        timestamp: message.timestamp,
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload?.message || "AI support flow failed"), { status: response.status });
  return payload;
};

const postMetaMessage = async ({ token, recipientId, messageText, sendContext = {} }) => {
  console.log("ai_inbox_send_graph_request", {
    recipient_id: maskIdForLog(recipientId),
    resolved_recipient_psid: maskIdForLog(sendContext.resolved_recipient_psid || recipientId),
    resolved_page_id: maskIdForLog(sendContext.resolved_page_id || ""),
    resolved_customer_id: maskIdForLog(sendContext.resolved_customer_id || recipientId),
    resolved_sender_id: maskIdForLog(sendContext.resolved_sender_id || recipientId),
    message_length: text(messageText).length,
    message_type: "text",
  });
  const response = await fetch(`${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: { text: text(messageText).slice(0, 2000) },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[meta-inbox] graph_send_error", {
      status: response.status,
      code: payload?.error?.code || "",
      subcode: payload?.error?.error_subcode || "",
      type: payload?.error?.type || "",
      message: payload?.error?.message || "Meta Send API failed",
      fbtrace_id: payload?.error?.fbtrace_id || "",
    });
    throw Object.assign(new Error(payload?.error?.message || "Meta Send API failed"), {
      status: response.status,
      code: payload?.error?.code || "",
      metaResponse: payload,
    });
  }
  console.log("[meta-inbox] graph_send_success", {
    recipient_id: maskIdForLog(recipientId),
    message_id: payload?.message_id || "",
    recipient_id_returned: maskIdForLog(payload?.recipient_id || ""),
  });
  return payload;
};

const postMetaImageMessage = async ({ token, recipientId, imageUrl, sendContext = {} }) => {
  console.log("ai_inbox_send_graph_request", {
    recipient_id: maskIdForLog(recipientId),
    resolved_recipient_psid: maskIdForLog(sendContext.resolved_recipient_psid || recipientId),
    resolved_page_id: maskIdForLog(sendContext.resolved_page_id || ""),
    resolved_customer_id: maskIdForLog(sendContext.resolved_customer_id || recipientId),
    resolved_sender_id: maskIdForLog(sendContext.resolved_sender_id || recipientId),
    message_type: "image",
    image_url_exists: Boolean(text(imageUrl)),
  });
  const response = await fetch(`${GRAPH_BASE_URL}/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: json({
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",
      message: {
        attachment: {
          type: "image",
          payload: { url: text(imageUrl), is_reusable: true },
        },
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("[meta-inbox] graph_send_error", {
      status: response.status,
      code: payload?.error?.code || "",
      subcode: payload?.error?.error_subcode || "",
      type: payload?.error?.type || "",
      message: payload?.error?.message || "Meta image send failed",
      fbtrace_id: payload?.error?.fbtrace_id || "",
      message_type: "image",
    });
    throw Object.assign(new Error(payload?.error?.message || "Meta image send failed"), {
      status: response.status,
      code: payload?.error?.code || "",
      metaResponse: payload,
    });
  }
  console.log("[meta-inbox] graph_send_success", {
    recipient_id: maskIdForLog(recipientId),
    message_id: payload?.message_id || "",
    recipient_id_returned: maskIdForLog(payload?.recipient_id || ""),
    message_type: "image",
  });
  return payload;
};

const imageAttachmentUrls = (attachments = []) =>
  (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => text(attachment?.url || attachment?.imageUrl || attachment?.image_url))
    .filter((url, index, urls) => /^https?:\/\//i.test(url) && urls.indexOf(url) === index)
    .slice(0, 3);

let commerceSchemaReadyPromise = null;

const ensureCommerceConversationSchema = async () => {
  if (!commerceSchemaReadyPromise) {
    commerceSchemaReadyPromise = (async () => {
      await ensureAiSupportLogSchema();
      await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS hot_lead BOOLEAN NOT NULL DEFAULT FALSE`);
      await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS lead_score INTEGER NOT NULL DEFAULT 0`);
      await db.query(`ALTER TABLE IF EXISTS ai_support_sessions ADD COLUMN IF NOT EXISTS ai_insight TEXT NOT NULL DEFAULT ''`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_ai_support_sessions_hot_lead ON ai_support_sessions (tenant_id, hot_lead, updated_at DESC)`);
    })().catch((error) => {
      commerceSchemaReadyPromise = null;
      throw error;
    });
  }
  return commerceSchemaReadyPromise;
};

const updateHotLeadState = async ({ tenantId, conversationId, score = 0, reason = "", insight = HOT_LEAD_INSIGHT } = {}) => {
  if (!tenantId || !conversationId) return null;
  await ensureCommerceConversationSchema();
  const hotLead = Number(score || 0) >= HOT_LEAD_THRESHOLD;
  const result = await db.query(
    `
    UPDATE ai_support_sessions
    SET
      hot_lead = hot_lead OR $3::boolean,
      lead_score = GREATEST(COALESCE(lead_score, 0), $4::int),
      ai_insight = CASE WHEN $3::boolean THEN $5::text ELSE ai_insight END,
      updated_at = NOW()
    WHERE tenant_id = $1::bigint AND session_id = $2::text
    RETURNING hot_lead, lead_score, ai_insight
    `,
    [tenantId, conversationId, hotLead, Math.max(0, Math.min(100, Math.round(Number(score || 0)))), insight]
  ).catch((error) => {
    console.warn("ai_inbox_hot_lead_update_failed", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      message: error?.message || "hot lead update failed",
    });
    return { rows: [] };
  });
  if (hotLead) {
    console.log("ai_inbox_hot_lead_detected", {
      tenant_id: tenantId,
      conversation_id: conversationId,
      score,
      reason,
      insight,
    });
    emitAiInboxEvent(tenantId, "ai_inbox:hot_lead", {
      sessionId: conversationId,
      hot_lead: true,
      lead_score: score,
      insight,
      reason,
    });
  }
  return result.rows[0] || null;
};

const rememberLastProductCards = ({ conversationId, productCards = [], sentMessages = [] } = {}) => {
  const current = getConversationMemory(conversationId) || {};
  const viewedImageUrls = new Set(Array.isArray(current.viewedImageUrls) ? current.viewedImageUrls.map(imageIdentity).filter(Boolean) : []);
  const viewedProductIds = new Set(Array.isArray(current.viewedProductIds) ? current.viewedProductIds.map(String).filter(Boolean) : []);
  const previousByMessageId = current.sentCardByMessageId && typeof current.sentCardByMessageId === "object" ? current.sentCardByMessageId : {};
  const cards = normalizeProductCards(productCards, { limit: 6 }).map((product, index) => ({
    message_id: text(sentMessages[index]?.message_id || sentMessages[index]?.meta_mid || sentMessages[index]?.id || ""),
    meta_mid: text(sentMessages[index]?.message_id || sentMessages[index]?.meta_mid || sentMessages[index]?.id || ""),
    image_message_id: text(sentMessages[index]?.image_message_id || sentMessages[index]?.image_mid || ""),
    product_id: product.product_id || product.id || null,
    variant_id: product.variant_id || null,
    name: product.name || "",
    color: product.color || "",
    sizes: Array.isArray(product.available_sizes) ? product.available_sizes : [],
    price: product.price || product.final_price || product.sale_price || product.product_price || null,
    image_url: product.image_url || "",
    product_url: product.product_url || product.url || "",
  }));
  if (!conversationId || !cards.length) return null;
  const sentCardByMessageId = { ...previousByMessageId };
  for (const card of cards) {
    const key = imageIdentity(card.image_url);
    if (key) viewedImageUrls.add(key);
    if (card.product_id) viewedProductIds.add(String(card.product_id));
    if (card.message_id) sentCardByMessageId[card.message_id] = card;
    if (card.meta_mid) sentCardByMessageId[card.meta_mid] = card;
    if (card.image_message_id) sentCardByMessageId[card.image_message_id] = card;
  }
  const shouldLockSingleCard = cards.length === 1 && Boolean(cards[0]?.product_id || cards[0]?.variant_id || cards[0]?.color);
  const nextMemory = updateConversationMemory(conversationId, {
    lastProductCards: cards,
    lastProductCard: cards[0],
    sentCardByMessageId,
    viewedImageUrls: [...viewedImageUrls],
    viewedProductIds: [...viewedProductIds],
    contextLocked: current.contextLocked === true || shouldLockSingleCard,
    selectedProductId: current.selectedProductId || (shouldLockSingleCard ? cards[0]?.product_id || null : null),
    selectedVariantId: current.selectedVariantId || (shouldLockSingleCard ? cards[0]?.variant_id || null : null),
    selectedColor: current.selectedColor || (shouldLockSingleCard ? cards[0]?.color || "" : ""),
    checkoutStage: checkoutStageAtLeast(current.checkoutStage, "buying_intent")
      ? current.checkoutStage
      : "product_selected",
  });
  if (shouldLockSingleCard) {
    console.log("ai_context_locked", {
      conversation_id: conversationId,
      reason: "single_product_card_sent",
      checkout_stage: nextMemory?.checkoutStage || "product_selected",
      product_id: cards[0]?.product_id || null,
      variant_id: cards[0]?.variant_id || null,
      color: cards[0]?.color || "",
    });
  }
  return nextMemory;
};

const lastProductCardFromMemory = (conversationId) => {
  const memory = getConversationMemory(conversationId);
  const cards = Array.isArray(memory?.lastProductCards) ? memory.lastProductCards : [];
  return cards[0] || memory?.lastProductCard || null;
};

const inboundReplyToMessageId = (message = {}) =>
  text(
    message.reply_to_message_id ||
      message.raw?.reply_to_message_id ||
      message.raw?.event?.message?.reply_to?.mid ||
      message.raw?.event?.message?.reply_to?.id ||
      message.raw?.event?.message?.reply_to_message?.mid ||
      message.raw?.event?.message?.reply_to_message?.id ||
      message.raw?.event?.message?.replied_message?.mid ||
      message.raw?.event?.message?.replied_message?.id ||
      message.raw?.event?.message?.context?.mid ||
      message.raw?.event?.message?.context?.id
  );

const colorsClarificationText = (cards = []) => {
  const colors = [...new Set(cards.map((card) => text(card.color)).filter(Boolean))].slice(0, 4);
  return colors.length >= 2
    ? `\u0623\u0646\u0647\u064a \u0644\u0648\u0646 \u062a\u0642\u0635\u062f\u061f ${colors.join(" \u0648\u0644\u0627 ")}\u061f`
    : "\u0623\u0646\u0647\u064a \u0644\u0648\u0646 \u062a\u0642\u0635\u062f\u061f";
};

const resolveContextProductCard = ({ message = {}, allowAmbiguous = false } = {}) => {
  const conversationId = message.external_conversation_id;
  const memory = getConversationMemory(conversationId) || {};
  const cards = Array.isArray(memory.lastProductCards) ? memory.lastProductCards : [];
  const replyTo = inboundReplyToMessageId(message);
  if (replyTo && memory.sentCardByMessageId?.[replyTo]) {
    console.log("ai_context_reply_to_resolved", {
      conversation_id: conversationId,
      reply_to_message_id: replyTo,
      product_id: memory.sentCardByMessageId[replyTo]?.product_id || null,
      variant_id: memory.sentCardByMessageId[replyTo]?.variant_id || null,
      color: memory.sentCardByMessageId[replyTo]?.color || "",
    });
    return { card: memory.sentCardByMessageId[replyTo], source: "reply_to", ambiguous: false, cards };
  }
  const selected = cards.find((card) =>
    (memory.selectedProductId && String(card.product_id || "") === String(memory.selectedProductId)) ||
    (memory.selectedVariantId && String(card.variant_id || "") === String(memory.selectedVariantId)) ||
    (memory.selectedColor && text(card.color).toLowerCase() === text(memory.selectedColor).toLowerCase())
  );
  if (selected) {
    console.log("ai_context_last_card_resolved", {
      conversation_id: conversationId,
      source: "selected_memory",
      product_id: selected.product_id || null,
      variant_id: selected.variant_id || null,
      color: selected.color || "",
    });
    return { card: selected, source: "selected_memory", ambiguous: false, cards };
  }
  if (cards.length === 1 || allowAmbiguous) {
    const card = cards[0] || memory.lastProductCard || null;
    if (card) {
      console.log("ai_context_last_card_resolved", {
        conversation_id: conversationId,
        source: cards.length === 1 ? "single_last_card" : "first_last_card",
        product_id: card.product_id || null,
        variant_id: card.variant_id || null,
        color: card.color || "",
      });
    }
    return { card, source: cards.length === 1 ? "single_last_card" : "first_last_card", ambiguous: false, cards };
  }
  if (cards.length > 1) return { card: null, source: "multiple_last_cards", ambiguous: true, cards };
  return { card: memory.lastProductCard || null, source: "lastProductCard", ambiguous: false, cards };
};

const lockProductContext = ({ conversationId, card = {}, stage = "product_selected", reason = "" } = {}) => {
  if (!conversationId || !card) {
    console.log("ai_context_lost", {
      conversation_id: conversationId || "",
      reason: reason || "missing_context_card",
    });
    return null;
  }
  const nextMemory = updateConversationMemory(conversationId, {
    contextLocked: true,
    selectedProductId: card.product_id || card.id || null,
    selectedVariantId: card.variant_id || null,
    selectedColor: card.color || "",
    checkoutStage: stage,
  });
  console.log("ai_context_locked", {
    conversation_id: conversationId,
    reason,
    checkout_stage: stage,
    product_id: card.product_id || card.id || null,
    variant_id: card.variant_id || null,
    color: card.color || "",
  });
  return nextMemory;
};

const unlockProductContext = ({ conversationId, reason = "" } = {}) => {
  if (!conversationId) return null;
  const memory = getConversationMemory(conversationId) || {};
  const nextMemory = updateConversationMemory(conversationId, {
    contextLocked: false,
    selectedProductId: null,
    selectedVariantId: null,
    selectedColor: "",
    checkoutStage: "browsing",
  });
  console.log("ai_context_lost", {
    conversation_id: conversationId,
    reason,
    previous_product_id: memory.selectedProductId || memory.lastProductCard?.product_id || null,
    previous_variant_id: memory.selectedVariantId || memory.lastProductCard?.variant_id || null,
    previous_color: memory.selectedColor || memory.lastProductCard?.color || "",
  });
  return nextMemory;
};

const stockedVariants = (product = {}) =>
  (Array.isArray(product?.variants) ? product.variants : []).filter((variant) => Number(variant?.stock || 0) > 0);

const availableSizesForProduct = (product = {}, baseCard = {}) => {
  const fallback = Array.isArray(baseCard.sizes) ? baseCard.sizes : [];
  if (fallback.length) return [...new Set(fallback.map(text).filter(Boolean))];
  const baseColor = text(baseCard.color).toLowerCase();
  const variants = baseColor
    ? stockedVariants(product).filter((variant) => text(variant.color || variant.color_name || variant.color_value).toLowerCase() === baseColor)
    : stockedVariants(product);
  const sizes = variants.map((variant) => text(variant.size)).filter(Boolean);
  return [...new Set([...sizes, ...fallback.map(text)].filter(Boolean))];
};

const chooseVariantForSize = (product = {}, requestedSize = "", fallbackVariantId = null) => {
  const variants = stockedVariants(product);
  const normalizedSize = text(requestedSize).toLowerCase();
  const fallback = variants.find((variant) => Number(variant.id) === Number(fallbackVariantId));
  const fallbackColor = text(fallback?.color || fallback?.color_name || fallback?.color_value).toLowerCase();
  const colorVariants = fallbackColor
    ? variants.filter((variant) => text(variant.color || variant.color_name || variant.color_value).toLowerCase() === fallbackColor)
    : variants;
  if (!normalizedSize) return fallback || colorVariants[0] || variants[0] || null;
  return colorVariants.find((variant) => text(variant.size).toLowerCase() === normalizedSize) ||
    colorVariants.find((variant) => text(variant.name).toLowerCase().includes(normalizedSize)) ||
    fallback ||
    null;
};

const loadRememberedProduct = async ({ tenantId, card, messageText = "" } = {}) => {
  if (!card) return null;
  const products = await searchAiOrderProducts({
    tenantId,
    message: card.name || messageText,
    metadata: { product_id: card.product_id || card.id },
  });
  return products.find((product) => String(product.id || product.product_id || "") === String(card.product_id || card.id || "")) || products[0] || null;
};

const parseImageValues = (value) => {
  if (Array.isArray(value)) return value.flatMap(parseImageValues);
  if (value && typeof value === "object") {
    return parseImageValues([value.secure_url, value.image_url, value.url, value.path, value.src, value.preview, value.image]);
  }
  const safe = text(value);
  if (!safe) return [];
  try {
    const parsed = JSON.parse(safe);
    if (parsed && parsed !== safe) return parseImageValues(parsed);
  } catch {
    return [safe];
  }
  return [safe];
};

const uniqueImageUrls = (values = []) => {
  const seen = new Set();
  const urls = [];
  for (const raw of values.flatMap(parseImageValues)) {
    const url = resolvePublicProductImageUrl(raw);
    const key = imageIdentity(url);
    if (!url || !key || seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
};

const downloadImageForVision = async ({ imageUrl = "", token = "" } = {}) => {
  const safeUrl = text(imageUrl);
  if (!/^https?:\/\//i.test(safeUrl)) {
    throw Object.assign(new Error("Unsupported image URL"), { code: "INVALID_IMAGE_URL" });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VISUAL_IMAGE_TIMEOUT_MS);
  const downloadAttempts = [
    { url: safeUrl, headers: token && !/[?&]access_token=/i.test(safeUrl) ? { Authorization: `Bearer ${token}` } : {}, mode: "bearer_or_direct" },
    { url: safeUrl, headers: {}, mode: "direct_no_auth" },
    token && !/[?&]access_token=/i.test(safeUrl)
      ? { url: `${safeUrl}${safeUrl.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, headers: {}, mode: "query_access_token" }
      : null,
  ].filter(Boolean);
  let lastError = null;
  try {
    for (const attempt of downloadAttempts) {
      try {
        const response = await fetch(attempt.url, { headers: attempt.headers, signal: controller.signal });
        if (!response.ok) throw Object.assign(new Error(`Image download failed: ${response.status}`), { status: response.status, mode: attempt.mode });
        const contentType = text(response.headers.get("content-type")).toLowerCase();
        if (contentType && !contentType.startsWith("image/")) {
          throw Object.assign(new Error("Downloaded attachment is not an image"), { code: "INVALID_IMAGE_CONTENT_TYPE", contentType, mode: attempt.mode });
        }
        const length = Number(response.headers.get("content-length") || 0);
        if (length > MAX_VISUAL_IMAGE_BYTES) {
          throw Object.assign(new Error("Image is too large for visual search"), { code: "IMAGE_TOO_LARGE", bytes: length, mode: attempt.mode });
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_VISUAL_IMAGE_BYTES) {
          throw Object.assign(new Error("Image is too large for visual search"), { code: "IMAGE_TOO_LARGE", bytes: arrayBuffer.byteLength, mode: attempt.mode });
        }
        return {
          imageBuffer: Buffer.from(arrayBuffer),
          mimeType: contentType || "image/jpeg",
          bytes: arrayBuffer.byteLength,
          downloadMode: attempt.mode,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || Object.assign(new Error("Image download failed"), { code: "IMAGE_DOWNLOAD_FAILED" });
  } finally {
    clearTimeout(timeout);
  }
};

const visualSearchQueryFromUnderstanding = (understanding = {}) => {
  const detected = understanding?.detected || {};
  return [
    detected.brand_family || detected.brand,
    detected.likely_model,
    ...(Array.isArray(detected.colors) ? detected.colors : []),
    ...(Array.isArray(detected.main_colors) ? detected.main_colors : []),
    detected.product_type || detected.category,
    detected.silhouette_style || detected.style,
    detected.high_top_low_top,
    ...(Array.isArray(detected.distinctive_features) ? detected.distinctive_features.slice(0, 4) : []),
    ...(Array.isArray(detected.model_keywords) ? detected.model_keywords.slice(0, 4) : []),
  ].map(text).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
};

const normalizedSearchText = (value = "") => text(value).toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]+/g, " ");

const visualQueryTokens = (query = "") => {
  const normalized = normalizedSearchText(query);
  return {
    normalized,
    hasJordan: /\bjordan\b|جوردن/.test(normalized),
    hasJordan4: /\bjordan\s*4\b|\bair\s+jordan\s*4\b|\bretro\s*4\b|جوردن\s*4/.test(normalized),
    hasNike: /\bnike\b|نايك/.test(normalized),
    hasLowTop: /\blow\b|\blowtop\b|\blow top\b|\blow profile\b|\bslim sole\b|\bflat sole\b/.test(normalized),
    hasCasualSkate: /\bcasual\b|\bskate\b|\bdunk\b|\bcourt\b|\bstreetwear\b|\blifestyle\b/.test(normalized),
    hasGraphicPattern: /\bgraphic\b|\bpattern\b|\bprinted\b|\bside panel\b|\bpanel\b|\bcartoon\b|\bcomic\b|\billustration\b|\bside graphic\b|\bprinted side\b/.test(normalized),
    hasBlackWhite: (/\bblack\b/.test(normalized) && /\bwhite\b/.test(normalized)) || /\bblack white\b|\bwhite black\b/.test(normalized),
    hasTrailRunning: /\btrail\b|\brunning\b|\brunner\b|\boutdoor\b|\bhiking\b|\bterrex\b|\bgoretex\b|\bgore tex\b|\bchunky\b/.test(normalized),
  };
};

const productVisualText = (product = {}) =>
  normalizedSearchText([
    product.name,
    product.slug,
    product.canonical_slug,
    product.brand,
    product.model,
    product.search_text,
    product.visual_search_tags,
    product.variant_image_url,
    ...(Array.isArray(product.variants) ? product.variants.flatMap((variant) => [variant.name, variant.color, variant.sku]) : []),
  ].filter(Boolean).join(" "));

const visualSearchTagsForProduct = (product = {}) => {
  const blob = normalizedSearchText([product.name, product.slug, product.canonical_slug, product.brand, product.model, product.search_text].filter(Boolean).join(" "));
  const tags = [];
  if (/\blow\b|\bdunk\b|\bcourt\b|\bskate\b|\bcasual\b|\blifestyle\b/.test(blob)) tags.push("low", "casual", "skate", "dunk style");
  if (/\bgraphic\b|\bpattern\b|\bprinted\b|\bcartoon\b|\bcomic\b|\bpanel\b/.test(blob)) tags.push("graphic side", "printed side", "black white");
  if (/\bblack\b/.test(blob) && /\bwhite\b/.test(blob)) tags.push("black white");
  if (/\bterrex\b|\bgoretex\b|\btrail\b|\brunning\b|\bhiking\b/.test(blob)) tags.push("trail running outdoor");
  return [...new Set(tags)].join(" ");
};

const visualScoreBreakdown = ({ product = {}, query = "", baseScore = 0 } = {}) => {
  const queryInfo = visualQueryTokens(query);
  const productText = productVisualText(product);
  const productLow = /\blow\b|\blowtop\b|\blow top\b|\blow profile\b|\bslim sole\b|\bflat sole\b|\bdunk\b|\bcourt\b|\bskate\b|\bcasual\b/.test(productText);
  const productGraphic = /\bgraphic\b|\bpattern\b|\bprinted\b|\bside panel\b|\bpanel\b|\bcartoon\b|\bcomic\b|\billustration\b|\bblack white panel\b|\bwhite black panel\b/.test(productText);
  const productBlackWhite = /\bblack\b/.test(productText) && /\bwhite\b/.test(productText);
  const productTrailRunning = /\btrail\b|\brunning\b|\brunner\b|\boutdoor\b|\bhiking\b|\bterrex\b|\bgoretex\b|\bgore tex\b|\bchunky\b/.test(productText);
  const productJordan4 = /\bjordan\s*4\b|\bair\s+jordan\s*4\b|\bretro\s*4\b|jordan-4/.test(productText);
  const productJordan = /\bjordan\b|jordan-/.test(productText);
  const breakdown = {
    base_score: Number(baseScore || product.confidence || 0),
    silhouette_score: 0,
    category_score: 0,
    graphic_pattern_score: 0,
    color_score: 0,
    brand_score: 0,
    penalties: 0,
    final_score: 0,
    flags: {
      query_low_top: queryInfo.hasLowTop,
      query_casual_skate: queryInfo.hasCasualSkate,
      query_graphic_pattern: queryInfo.hasGraphicPattern,
      query_black_white: queryInfo.hasBlackWhite,
      product_low: productLow,
      product_graphic: productGraphic,
      product_black_white: productBlackWhite,
      product_trail_running: productTrailRunning,
    },
  };
  if (queryInfo.hasLowTop && productLow) breakdown.silhouette_score += 0.35;
  if (queryInfo.hasCasualSkate && productLow) breakdown.category_score += 0.3;
  if (queryInfo.hasGraphicPattern && productGraphic) breakdown.graphic_pattern_score += 0.45;
  if (queryInfo.hasBlackWhite && productBlackWhite) breakdown.color_score += 0.25;
  if (queryInfo.hasJordan4 && productJordan4) breakdown.brand_score += 0.65;
  else if (queryInfo.hasJordan && productJordan) breakdown.brand_score += 0.35;
  if (queryInfo.hasNike && /\bnike\b/.test(productText)) breakdown.brand_score += 0.12;
  if ((queryInfo.hasLowTop || queryInfo.hasCasualSkate || queryInfo.hasGraphicPattern) && productTrailRunning) breakdown.penalties -= 0.75;
  if (queryInfo.hasGraphicPattern && !productGraphic) breakdown.penalties -= 0.25;
  if (queryInfo.hasLowTop && !productLow) breakdown.penalties -= 0.2;
  breakdown.final_score = Math.max(0, Math.min(1, breakdown.base_score + breakdown.silhouette_score + breakdown.category_score + breakdown.graphic_pattern_score + breakdown.color_score + breakdown.brand_score + breakdown.penalties));
  return breakdown;
};

const listTokens = (...items) => [
  ...new Set(
    items
      .flatMap((item) => Array.isArray(item) ? item : [item])
      .map(text)
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
  ),
];

const hasAnyToken = (blob = "", tokensList = []) => {
  const normalized = normalizedSearchText(blob);
  return tokensList.some((token) => token && normalized.includes(normalizedSearchText(token)));
};

const visualAnalysisFromUnderstanding = (understanding = {}) => {
  const detected = understanding?.detected || {};
  return {
    brand: text(detected.brand_guess || detected.brand_family || detected.brand),
    modelFamily: text(detected.model_family || detected.likely_model || detected.model_guess),
    shoeType: text(detected.shoe_type || detected.product_type || detected.category),
    silhouette: text(detected.silhouette_style || detected.silhouette || detected.high_top_low_top),
    primaryColors: Array.isArray(detected.main_colors) ? detected.main_colors : detected.colors || [],
    secondaryColors: Array.isArray(detected.secondary_colors) ? detected.secondary_colors : [],
    soleType: text(detected.sole_shape),
    logoPosition: text(detected.logo_position),
    notableFeatures: [
      ...(Array.isArray(detected.notable_features) ? detected.notable_features : []),
      ...(Array.isArray(detected.distinctive_features) ? detected.distinctive_features : []),
      ...(Array.isArray(detected.features) ? detected.features : []),
    ].map(text).filter(Boolean).slice(0, 12),
    confidence: Math.max(0, Math.min(100, Number(understanding?.confidence || detected.confidence || 0) * 100)),
    raw: detected,
  };
};

const strictVisualScoreProduct = ({ product = {}, analysis = {}, indexedScore = 0 } = {}) => {
  const blob = productVisualText(product);
  const brandTokens = listTokens(analysis.brand);
  const modelTokens = listTokens(analysis.modelFamily);
  const silhouetteTokens = listTokens(analysis.shoeType, analysis.silhouette);
  const colorTokens = listTokens(analysis.primaryColors, analysis.secondaryColors);
  const detailTokens = listTokens(analysis.soleType, analysis.logoPosition, analysis.notableFeatures);
  const productTrail = /\b(trail|running|runner|outdoor|hiking|terrex|goretex|gore tex)\b/.test(blob);
  const queryJordan = hasAnyToken([analysis.brand, analysis.modelFamily].join(" "), ["jordan", "air jordan", "aj4", "j4"]);
  const productJordan = /\bjordan\b|\bair jordan\b|\baj4\b|\bj4\b/.test(blob);
  const queryJordan4 = hasAnyToken(analysis.modelFamily, ["jordan 4", "air jordan 4", "aj4", "j4", "retro 4"]);
  const productJordan4 = /\b(jordan\s*4|air\s*jordan\s*4|aj4|j4|retro\s*4)\b/.test(blob);
  const brandMatch = brandTokens.length ? hasAnyToken(blob, brandTokens) || (queryJordan && productJordan) : false;
  const modelMatch = modelTokens.length ? hasAnyToken(blob, modelTokens) || (queryJordan4 && productJordan4) : false;
  const silhouetteMatch = silhouetteTokens.length ? hasAnyToken(blob, silhouetteTokens) : false;
  const colorMatches = colorTokens.filter((token) => hasAnyToken(blob, [token])).length;
  const detailMatches = detailTokens.filter((token) => hasAnyToken(blob, [token])).length;
  const colorScore = colorTokens.length ? Math.min(1, colorMatches / Math.min(3, colorTokens.length)) : 0;
  const detailScore = detailTokens.length ? Math.min(1, detailMatches / Math.min(4, detailTokens.length)) : 0;
  const silhouetteScore = silhouetteMatch ? 1 : Number(product.visual_score_breakdown?.silhouette_score || 0) > 0 ? 0.65 : 0;
  const brandScore = brandMatch ? 1 : Number(product.visual_score_breakdown?.brand_score || 0) > 0 ? 0.55 : 0;
  const modelScore = modelMatch ? 1 : Number(product.visual_score_breakdown?.model_score || 0) > 0 ? 0.55 : 0;
  let score = (brandScore * 40) + (modelScore * 30) + (silhouetteScore * 15) + (colorScore * 10) + (detailScore * 5);
  if (indexedScore > 0) score = Math.max(score, Math.min(100, indexedScore * 100));
  if ((queryJordan || queryJordan4) && productTrail) score -= 45;
  if (queryJordan4 && !productJordan) score -= 35;
  if (queryJordan4 && productJordan && !productJordan4) score -= 12;
  score = Math.max(0, Math.min(100, score));
  return {
    strict_visual_score: score,
    brand_score: brandScore * 40,
    model_family_score: modelScore * 30,
    silhouette_score: silhouetteScore * 15,
    color_score: colorScore * 10,
    detail_score: detailScore * 5,
    penalty_trail_running: (queryJordan || queryJordan4) && productTrail ? -45 : 0,
    penalty_wrong_jordan_family: queryJordan4 && !productJordan ? -35 : 0,
    brand_match: brandMatch,
    model_match: modelMatch,
    silhouette_match: silhouetteMatch,
    color_matches: colorMatches,
    detail_matches: detailMatches,
  };
};

const rankStrictVisualProducts = ({ products = [], analysis = {} } = {}) =>
  products
    .map((product) => {
      const strict = strictVisualScoreProduct({
        product,
        analysis,
        indexedScore: Number(product.visual_confidence_score || product.confidence || 0),
      });
      return {
        ...product,
        visual_confidence_score: strict.strict_visual_score / 100,
        visual_score_breakdown: {
          ...(product.visual_score_breakdown || {}),
          strict_sales_brain_v2: strict,
        },
      };
    })
    .sort((left, right) => Number(right.visual_confidence_score || 0) - Number(left.visual_confidence_score || 0));

const visualDecisionForConfidence = ({ visualConfidence = 0, matchConfidence = 0, hasExact = false, alternativesRequested = false } = {}) => {
  const confidence = Math.max(0, Math.min(100, Math.round(Math.min(visualConfidence || 0, matchConfidence || 0))));
  if (visualConfidence < 70 || !matchConfidence) return { replyType: "clarification", limit: 0, confidence };
  if (confidence < 70) return { replyType: "no_match", limit: 0, confidence };
  if (confidence < 80) return { replyType: "close_match", limit: alternativesRequested ? 2 : 1, confidence };
  if (confidence <= 90) return { replyType: hasExact ? "exact_match" : "close_match", limit: 2, confidence };
  return { replyType: hasExact ? "exact_match" : "close_match", limit: alternativesRequested ? 2 : 1, confidence };
};

const oneCardPerProduct = (productCards = []) => {
  const seen = new Set();
  const selected = [];
  for (const card of productCards) {
    const key = String(card.product_id || card.id || card.base_name || card.name || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(card);
  }
  return selected;
};

const filterNewProductRecommendations = ({ conversationId, productCards = [], allowRepeat = false } = {}) => {
  if (allowRepeat) return productCards;
  const memory = getConversationMemory(conversationId) || {};
  const viewed = new Set(Array.isArray(memory.viewedProductIds) ? memory.viewedProductIds.map(String).filter(Boolean) : []);
  return productCards.filter((product) => !viewed.has(String(product.product_id || product.id || "")));
};

const productSalesSignals = async ({ tenantId, productId, variant = null } = {}) => {
  if (!tenantId || !productId) return { recent_orders: 0, high_demand: false, low_stock: false };
  const recent = await db.query(
    `
    SELECT COUNT(*)::int AS recent_orders
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.product_id = $1
      AND o.tenant_id = $2
      AND o.created_at >= NOW() - INTERVAL '14 days'
      AND LOWER(COALESCE(o.status, '')) NOT IN ('cancelled','canceled','refunded','returned')
    `,
    [productId, tenantId]
  ).catch(() => ({ rows: [] }));
  const stock = Number(variant?.stock ?? 999);
  const recentOrders = Number(recent.rows[0]?.recent_orders || 0);
  return {
    recent_orders: recentOrders,
    high_demand: recentOrders >= 3,
    low_stock: Number.isFinite(stock) && stock > 0 && stock <= LOW_STOCK_THRESHOLD,
  };
};

const closerLineForProduct = (signals = {}) => {
  if (signals.low_stock) return "بيخلص بسرعة بصراحة.";
  if (signals.high_demand) return "الموديل ده عليه طلب عالي اليومين دول.";
  return "خامته ممتازة جدًا ومريح في اللبس.";
};

const searchVisualInventory = async ({ tenantId, query = "", metadata = {}, conversationId = "" } = {}) => {
  const queryInfo = visualQueryTokens(query);
  const fallbackQueries = [
    query,
    queryInfo.hasGraphicPattern ? "black white low sneaker graphic side printed side pattern casual skate" : "",
    queryInfo.hasLowTop || queryInfo.hasCasualSkate ? "low casual skate sneaker dunk style black white" : "",
    queryInfo.hasJordan4 ? "air jordan 4 jordan 4 retro 4" : "",
    queryInfo.hasJordan ? "jordan 4 air jordan sneaker" : "",
    queryInfo.hasJordan ? "jordan sneaker" : "",
    "sneaker",
    "shoe",
  ].map(text).filter((item, index, items) => item && items.indexOf(item) === index);
  const combined = new Map();
  const attempts = [];
  for (const searchQuery of fallbackQueries) {
    const rows = await searchAiOrderProducts({
      tenantId,
      message: searchQuery,
      metadata: {
        ...metadata,
        image_search_query: searchQuery,
        keywords: [
          ...(Array.isArray(metadata.keywords) ? metadata.keywords : []),
          ...(queryInfo.hasJordan4 ? ["air jordan 4", "jordan 4", "retro 4"] : []),
          ...(queryInfo.hasJordan ? ["jordan"] : []),
          ...(queryInfo.hasGraphicPattern ? ["graphic side", "printed side", "pattern", "cartoon", "comic", "black white panel"] : []),
          ...(queryInfo.hasLowTop || queryInfo.hasCasualSkate ? ["low", "casual", "skate", "dunk style", "low sneaker", "black white"] : []),
        ],
      },
    }).catch((error) => {
      console.warn("ai_inbox_visual_inventory_search_attempt_failed", {
        tenant_id: tenantId,
        conversation_id: conversationId,
        inventory_search_query: searchQuery,
        message: error?.message || "inventory search failed",
      });
      return [];
    });
    attempts.push({
      query: searchQuery,
      result_count: rows.length,
      top_products: rows.slice(0, 5).map((product) => ({ id: product.id, name: product.name, confidence: product.confidence })),
    });
    for (const product of rows) {
      const key = String(product.id || product.product_id || product.name);
      const enrichedProduct = { ...product, visual_search_tags: visualSearchTagsForProduct(product) };
      const scoreBreakdown = visualScoreBreakdown({ product: enrichedProduct, query, baseScore: product.confidence });
      const score = scoreBreakdown.final_score;
      const existing = combined.get(key);
      if (!existing || score > Number(existing.visual_confidence_score || 0)) {
        combined.set(key, { ...enrichedProduct, visual_confidence_score: score, visual_score_breakdown: scoreBreakdown, inventory_search_query: searchQuery });
      }
    }
    if (combined.size >= 3 && (queryInfo.hasJordan4 || rows.some((product) => Number(product.confidence || 0) >= 0.5))) break;
  }
  return {
    products: [...combined.values()].sort((a, b) => Number(b.visual_confidence_score || 0) - Number(a.visual_confidence_score || 0)),
    attempts,
  };
};

const productCardsForIndexedImageMatch = async ({ tenantId, match = null, visualQuery = "" } = {}) => {
  if (!match?.product_id) return [];
  const query = [match.detected_model, match.visual_text, visualQuery, match.product_id].map(text).filter(Boolean).join(" ");
  const rows = await searchAiOrderProducts({
    tenantId,
    message: query || String(match.product_id),
    metadata: {
      visual_exact_inventory_match: true,
      product_id: match.product_id,
      variant_id: match.variant_id ?? null,
      image_search_query: query,
    },
  }).catch((error) => {
    console.warn("ai_inbox_visual_exact_product_lookup_failed", {
      tenant_id: tenantId || null,
      product_id: match.product_id,
      variant_id: match.variant_id ?? null,
      message: error?.message || "product lookup failed",
    });
    return [];
  });
  const matchingRows = rows.filter((product) => String(product.id || product.product_id) === String(match.product_id));
  return (matchingRows.length ? matchingRows : rows).slice(0, 1).map((product) => ({
    ...product,
    image_url: match.image_url || product.image_url,
    product_image_url: match.image_url || product.product_image_url || product.image_url,
    matched_image_url: match.image_url || "",
    matched_image_source: "ai_product_image_visual_index",
    matched_variant_id: match.variant_id ?? product.matched_variant_id ?? null,
    matched_variant_color: match.color || product.matched_variant_color || "",
    matched_variant_image: match.image_url || product.matched_variant_image || "",
    visual_confidence_score: Number(match.score || 0),
    visual_score_breakdown: match.score_breakdown || null,
    is_visual_search_match: true,
    matched_visual_candidate: {
      product_id: match.product_id,
      variant_id: match.variant_id ?? null,
      image_url: match.image_url || "",
      image_source: "ai_product_image_visual_index",
      color: match.color || "",
      score: match.score || 0,
    },
  }));
};

const loadVariantImageRows = async ({ tenantId, productId } = {}) => {
  if (!productId) return [];
  try {
    const result = await db.query(
      `
      SELECT
        image_url,
        secure_url,
        color_name,
        color_value,
        variant_id,
        is_primary,
        sort_order
      FROM product_variant_images
      WHERE product_id = $1
        AND ($2::bigint IS NULL OR tenant_id = $2::bigint OR tenant_id IS NULL)
      ORDER BY COALESCE(is_primary, FALSE) DESC, COALESCE(sort_order, 999999), id
      LIMIT 24
      `,
      [productId, numberOrNull(tenantId)]
    );
    return result.rows;
  } catch (error) {
    console.warn("ai_inbox_more_images_gallery_lookup_failed", {
      tenant_id: tenantId || null,
      product_id: productId || null,
      message: error?.message || "gallery lookup failed",
    });
    return [];
  }
};

const buildMoreImageCards = async ({ tenantId, conversationId, product = {}, baseCard = {}, includeOtherColors = false } = {}) => {
  const memory = getConversationMemory(conversationId) || {};
  const viewed = new Set(Array.isArray(memory.viewedImageUrls) ? memory.viewedImageUrls.map(imageIdentity).filter(Boolean) : []);
  const selectedColor = text(memory.selectedColor || baseCard.color).toLowerCase();
  const galleryRows = await loadVariantImageRows({ tenantId, productId: product.id || baseCard.product_id || baseCard.id });
  const variants = stockedVariants(product);
  const productGalleryUrls = uniqueImageUrls([product.product_images, product.gallery_images, product.images]);
  const sameColorRows = galleryRows.filter((row) => {
    const rowColor = text(row.color_name || row.color_value).toLowerCase();
    return selectedColor && rowColor && rowColor === selectedColor;
  });
  const pools = [
    sameColorRows.map((row) => ({ url: row.secure_url || row.image_url, color: row.color_name || row.color_value || baseCard.color, variant_id: row.variant_id, source: "same_color_gallery" })),
    selectedColor ? [] : productGalleryUrls.map((url) => ({ url, color: baseCard.color, variant_id: baseCard.variant_id, source: "product_gallery" })),
    includeOtherColors ? galleryRows.filter((row) => !sameColorRows.includes(row)).map((row) => ({ url: row.secure_url || row.image_url, color: row.color_name || row.color_value || "", variant_id: row.variant_id, source: "other_color_gallery" })) : [],
    includeOtherColors ? variants.map((variant) => ({ url: variant.secure_url || variant.image_url || variant.variant_image_url || variant.color_image_url, color: variant.color || "", variant_id: variant.id, source: "variant" })) : [],
  ];
  const selected = [];
  const seen = new Set();
  for (const candidate of pools.flat()) {
    const url = resolvePublicProductImageUrl(candidate.url);
    const key = imageIdentity(url);
    if (!url || !key || viewed.has(key) || seen.has(key)) {
      if (key && viewed.has(key)) {
        console.log("ai_inbox_repeated_image_prevented", {
          tenant_id: tenantId || null,
          conversation_id: conversationId || "",
          product_id: product.id || baseCard.product_id || null,
          image_url: url,
          source: candidate.source || "",
        });
      }
      continue;
    }
    seen.add(key);
    selected.push({
      product_id: product.id || baseCard.product_id || baseCard.id || null,
      variant_id: candidate.variant_id || baseCard.variant_id || null,
      name: product.name || baseCard.name || "المنتج",
      price: product.product_price || baseCard.price || "",
      available_sizes: availableSizesForProduct(product, baseCard),
      color: candidate.color || baseCard.color || "",
      image_url: url,
      product_url: baseCard.product_url || baseCard.url || "",
      slug: product.slug || product.canonical_slug || "",
    });
    if (selected.length >= 4) break;
  }
  return selected;
};

const detectAllColorsRequest = (message = "") =>
  Boolean(hasTerm(message, ["\u0643\u0644 \u0627\u0644\u0623\u0644\u0648\u0627\u0646", "\u0643\u0644 \u0627\u0644\u0627\u0644\u0648\u0627\u0646", "\u0627\u0644\u0623\u0644\u0648\u0627\u0646", "\u0627\u0644\u0627\u0644\u0648\u0627\u0646", "all colors", "colours", "colors"]));

const detectOtherColorsRequest = (message = "") =>
  Boolean(hasTerm(message, ["\u0623\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629", "\u0627\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629", "\u0644\u0648\u0646 \u062a\u0627\u0646\u064a", "other colors", "another color"]));

const sendAndLogMetaText = async ({ config, message, text: replyText, detectedIntent = "", metadata = {} } = {}) => {
  const result = await sendMetaInboxOutboundMessage({
    tenantId: config.tenant_id,
    channel: message.channel,
    recipientId: message.external_customer_id,
    messageText: replyText,
    conversationId: message.external_conversation_id,
    facebookPageId: config.facebook_page_id,
    instagramBusinessAccountId: config.instagram_business_account_id,
    preferredConfigId: config.id,
  });
  const inserted = await appendAiGeneratedSupportReply({
    tenantId: config.tenant_id,
    sessionId: message.external_conversation_id,
    answer: replyText,
    detectedIntent,
    channel: message.channel,
    deliveryStatus: "sent",
    externalMessageId: result?.message_id || "",
  }).catch((error) => {
    console.error("[meta-inbox] ai_outbound_db_insert_failed", {
      tenant_id: config.tenant_id,
      session_id: message.external_conversation_id,
      channel: message.channel,
      message: error?.message || "AI outbound insert failed",
      code: error?.code || "",
    });
    return null;
  });
  console.log("[meta-inbox] ai_outbound_db_insert_result", {
    tenant_id: config.tenant_id,
    session_id: message.external_conversation_id,
    channel: message.channel,
    message_id: inserted?.id || null,
    delivery_status: inserted?.delivery_status || "",
    external_message_id: inserted?.external_message_id || result?.message_id || "",
  });
  await logChannelEvent({
    tenantId: config.tenant_id,
    channel: message.channel,
    direction: "outbound",
    externalCustomerId: message.external_customer_id,
    conversationId: message.external_conversation_id,
    messagePreview: replyText,
    status: "sent",
    metadata: { meta_message_id: result?.message_id || "", ...metadata },
  }).catch(() => {});
  return result;
};

const sendAndLogProductCards = async ({ config, message, productCards = [], detectedIntent = "", introText = "", metadata = {} } = {}) => {
  const modelNameSearch = detectModelNameSearch(message.message_text || "") && !detectAllColorsRequest(message.message_text || "");
  const cardLimit = Number(metadata.product_card_limit || 0) || (modelNameSearch ? (detectOtherColorsRequest(message.message_text || "") ? 3 : 2) : 6);
  const cards = await resolveProductCardLinks(normalizeProductCards(productCards, { limit: cardLimit }), { tenantId: config.tenant_id });
  if (!cards.length) return null;
  const gate = evaluateProductDecisionGate({
    productCards: cards,
    messageText: message.message_text || "",
    metadata,
    memory: getConversationMemory(message.external_conversation_id) || {},
    detectedIntent,
    allowAlternatives: Boolean(metadata.allow_alternatives || detectedIntent.includes("visual_search") || detectedIntent.includes("alternative")),
    limit: detectedIntent.includes("exact") || metadata.exact_inventory_match ? 1 : Math.min(3, cardLimit),
  });
  console.log("ai_inbox_product_decision_gate", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    detected_intent: detectedIntent,
    decision: gate.decision,
    should_send: gate.shouldSend,
    model_intent: gate.modelIntent,
    flags: gate.flags,
    products: gate.evaluated,
  });
  if (!gate.shouldSend) {
    await sendAndLogMetaText({
      config,
      message,
      text: gate.blockMessage,
      detectedIntent: `${detectedIntent || "product_cards"}_blocked_by_decision_gate`,
      metadata: {
        ...metadata,
        decision_gate: {
          decision: gate.decision,
          model_intent: gate.modelIntent,
          flags: gate.flags,
          products: gate.evaluated,
        },
      },
    });
    return { blocked: true, reason: "product_decision_gate_low_confidence", gate };
  }
  const gatedCards = await resolveProductCardLinks(
    normalizeProductCards(gate.products, { limit: detectedIntent.includes("exact") || metadata.exact_inventory_match ? 1 : Math.min(3, cardLimit) }),
    { tenantId: config.tenant_id }
  );
  const finalIntroText = modelNameSearch && gatedCards.length >= 2
    ? [modelColorLimitIntro, gate.introText || introText].filter(Boolean).join("\n")
    : gate.introText || introText;
  if (modelNameSearch) {
    console.log("ai_model_color_limit_applied", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      requested_limit: cardLimit,
      resulting_card_count: gatedCards.length,
      all_colors_requested: detectAllColorsRequest(message.message_text || ""),
      other_colors_requested: detectOtherColorsRequest(message.message_text || ""),
    });
  }
  if (finalIntroText) {
    await sendAndLogMetaText({
      config,
      message,
      text: finalIntroText,
      detectedIntent,
      metadata: { ...metadata, intro: true },
    });
  }
  const result = await sendMetaInboxOutboundMessage({
    tenantId: config.tenant_id,
    channel: message.channel,
    recipientId: message.external_customer_id,
    conversationId: message.external_conversation_id,
    productCards: gatedCards,
    productCardLimit: gatedCards.length,
    suggestedActions: META_COMMERCE_ACTIONS,
    facebookPageId: config.facebook_page_id,
    instagramBusinessAccountId: config.instagram_business_account_id,
    preferredConfigId: config.id,
  });
  rememberLastProductCards({ conversationId: message.external_conversation_id, productCards: gatedCards, sentMessages: result?.product_card_messages || [] });
  await recordLeadSignals({ config, message, reason: "product_cards_sent" }).catch(() => {});
  const preview = gatedCards.map(productCardReplyText).join("\n\n").slice(0, 500);
  await appendAiGeneratedSupportReply({
    tenantId: config.tenant_id,
    sessionId: message.external_conversation_id,
    answer: finalIntroText ? `${finalIntroText}\n${preview}` : preview,
    detectedIntent,
    suggestedProducts: gatedCards,
    suggestedActions: META_COMMERCE_ACTIONS,
    channel: message.channel,
    deliveryStatus: "sent",
    externalMessageId: result?.message_id || "",
  }).catch(() => {});
  await logChannelEvent({
    tenantId: config.tenant_id,
    channel: message.channel,
    direction: "outbound",
    externalCustomerId: message.external_customer_id,
    conversationId: message.external_conversation_id,
    messagePreview: finalIntroText ? `${finalIntroText}\n${preview}`.slice(0, 500) : preview,
    status: "sent",
    metadata: { meta_message_id: result?.message_id || "", product_card_count: gatedCards.length, decision_gate: gate.evaluated, ...metadata },
  }).catch(() => {});
  return result;
};

const repeatedProductCards = ({ conversationId, productCards = [] } = {}) => {
  const memory = getConversationMemory(conversationId) || {};
  const previousCards = Array.isArray(memory.lastProductCards) ? memory.lastProductCards : [];
  const cards = normalizeProductCards(productCards, { limit: 6 });
  if (!previousCards.length || !cards.length) return false;
  const previousKeys = new Set(
    previousCards
      .map((card) => `${card.product_id || card.id || ""}:${imageIdentity(card.image_url)}`)
      .filter((key) => key !== ":")
  );
  return cards.every((card) => previousKeys.has(`${card.product_id || card.id || ""}:${imageIdentity(card.image_url)}`));
};

const explicitlyAskedForProductCards = (message = "") =>
  Boolean(
    detectMoreImagesRequest(message) ||
      detectAllColorsRequest(message) ||
      detectOtherColorsRequest(message) ||
      detectSizesRequest(message) ||
      detectAlternativesRequest(message) ||
      detectModelNameSearch(message)
  );

const detectAlternativesRequest = (message = "") =>
  hasTerm(message, ["بدائل", "بديل", "شبهه", "شبهها", "similar", "alternative", "alternatives"]);

const detectModelNameSearch = (message = "") => {
  const normalized = normalizedSearchText(message);
  return Boolean(
    /\bjordan\s*4\b|\bj4\b|\baj4\b|\bair\s*jordan\b|\bjordan\b|\bshox\b|\bair\s*force\b|\bdunk\b|\bcampus\b|\bsamba\b|\byeezy\b/.test(normalized) ||
    /جوردن|جوردان|فور|شوك|شوكس|اير\s*فورس|دانك|كامبس|سامبا|ييزي|اديداس|نايك/.test(normalized)
  );
};

const modelColorLimitIntro = "\u0639\u0646\u062f\u064a \u0645\u0646\u0647 \u0643\u0630\u0627 \u0644\u0648\u0646. \u0623\u0628\u062f\u0623\u0644\u0643 \u0628\u0623\u0642\u0631\u0628 \u0644\u0648\u0646\u064a\u0646\u060c \u0648\u0644\u0648 \u062a\u062d\u0628 \u0623\u0628\u0639\u062a\u0647\u0645\u0644\u0643 \u0643\u0644\u0647\u0645.";

const answerFaqIfMatched = async ({ config, message } = {}) => {
  const faqIntent = detectFaqIntent(message.message_text);
  if (!faqIntent) return null;
  const settings = await getAiAgentSettings({ tenantId: config.tenant_id }).catch((error) => {
    console.warn("ai_inbox_faq_settings_missing", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      message: error?.message || "settings lookup failed",
    });
    return {};
  });
  const answers = {
    payment: readableArabicSetting(settings.cod_availability_text) || "أيوه، متاح الدفع عند الاستلام حسب المنطقة وشركة الشحن.",
    delivery: readableArabicSetting(settings.delivery_policy_text) || "الشحن حسب المحافظة والمنطقة. ابعتلي عنوانك أأكدلك التكلفة.",
    exchange: readableArabicSetting(settings.exchange_return_policy_text) || "ينفع الاستبدال حسب سياسة المتجر وحالة المنتج.",
  };
  const missingSettings = !answers[faqIntent] || answers[faqIntent] === {
    payment: "أيوه، متاح الدفع عند الاستلام حسب المنطقة وشركة الشحن.",
    delivery: "الشحن حسب المحافظة والمنطقة. ابعتلي عنوانك أأكدلك التكلفة.",
    exchange: "ينفع الاستبدال حسب سياسة المتجر وحالة المنتج.",
  }[faqIntent];
  console.log("ai_inbox_faq_answered", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    faq_intent: faqIntent,
    missing_settings: missingSettings,
  });
  await sendAndLogMetaText({
    config,
    message,
    text: answers[faqIntent],
    detectedIntent: `faq_${faqIntent}`,
    metadata: { faq_intent: faqIntent, missing_settings: missingSettings },
  });
  return { handled: true, reason: "faq_answered" };
};

const handleSizeAvailabilityLinkIfMatched = async ({ config, message } = {}) => {
  const memory = getConversationMemory(message.external_conversation_id) || {};
  const pendingLock = resolvePendingSizeBrowseQuality({ memory, message: message.message_text || "" });
  if (pendingLock.expired && pendingLock.clearPending) {
    updateConversationMemory(message.external_conversation_id, {
      pendingSizeBrowseSize: "",
      pendingSizeBrowseGender: "",
      pendingSizeBrowseQuery: "",
      pendingSizeBrowseSourceMessage: "",
      pendingSizeBrowseAwaitingQuality: false,
      pendingSizeBrowseStartedAt: "",
    });
    console.log("ai_inbox_size_browse_pending_timeout_reset", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      pending_size: memory.pendingSizeBrowseSize || "",
      other_intents_allowed: true,
    });
  }
  if (pendingLock.locked && pendingLock.handled) {
    const intent = pendingLock.intent || {};
    const url = pendingLock.url || buildSizeAvailabilityStorefrontUrl(intent);
    updateConversationMemory(message.external_conversation_id, {
      pendingSizeBrowseSize: "",
      pendingSizeBrowseGender: "",
      pendingSizeBrowseQuery: "",
      pendingSizeBrowseSourceMessage: "",
      pendingSizeBrowseAwaitingQuality: false,
      pendingSizeBrowseStartedAt: "",
    });
    console.log("ai_inbox_size_browse_pending_intent_lock_activated", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      pending_size: memory.pendingSizeBrowseSize || "",
      quality_selected: true,
      quality: intent.quality || "",
      other_intents_skipped: true,
      skipped_intents: ["product_search", "visual_search", "recommendation", "faq", "conversational"],
      generated_url: url,
    });
    console.log("ai_inbox_size_browse_quality_selected", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      size: intent.size,
      gender: intent.gender,
      query: intent.query,
      quality: intent.quality,
      generated_url: url,
    });
    await sendAndLogMetaText({
      config,
      message,
      text: sizeAvailabilityReplyText({ ...intent, url }),
      detectedIntent: "size_availability_storefront_link",
      metadata: {
        size_availability_intent: true,
        pending_intent_lock_activated: true,
        other_intents_skipped: true,
        pending_size_browse_resolved: true,
        size: intent.size,
        gender: intent.gender,
        query: intent.query,
        quality: intent.quality,
        generated_url: url,
      },
    });
    return { handled: true, reason: "size_availability_storefront_link_pending_lock" };
  }
  const intent = detectSizeAvailabilityIntent(message.message_text || "");
  if (!intent.detected) return null;
  console.log("ai_inbox_size_browse_detected", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    size: intent.size,
    gender: intent.gender || "",
    query: intent.query || "",
    quality: intent.quality || "",
  });
  if (!intent.qualityDetected) {
    updateConversationMemory(message.external_conversation_id, {
      pendingSizeBrowseSize: intent.size,
      pendingSizeBrowseGender: intent.gender || "",
      pendingSizeBrowseQuery: intent.query || "",
      pendingSizeBrowseSourceMessage: message.message_text || "",
      pendingSizeBrowseAwaitingQuality: true,
      pendingSizeBrowseStartedAt: new Date().toISOString(),
    });
    console.log("ai_inbox_size_browse_quality_missing_clarification", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      size: intent.size,
      gender: intent.gender || "",
      query: intent.query || "",
      pending_state_saved: true,
    });
    await sendAndLogMetaText({
      config,
      message,
      text: sizeAvailabilityClarificationText(intent),
      detectedIntent: "size_availability_quality_clarification",
      metadata: {
        size_availability_intent: true,
        quality_missing: true,
        pending_state_saved: true,
        size: intent.size,
        gender: intent.gender || "",
        query: intent.query || "",
      },
    });
    return { handled: true, reason: "size_availability_quality_clarification" };
  }
  const url = buildSizeAvailabilityStorefrontUrl(intent);
  console.log("ai_inbox_size_availability_intent_detected", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    size: intent.size,
    gender: intent.gender || "",
    query: intent.query || "",
    quality: intent.quality || "",
    generated_url: url,
  });
  await sendAndLogMetaText({
    config,
    message,
    text: sizeAvailabilityReplyText({ ...intent, url }),
    detectedIntent: "size_availability_storefront_link",
    metadata: {
      size_availability_intent: true,
      size: intent.size,
      gender: intent.gender || "",
      query: intent.query || "",
      quality: intent.quality || "",
      generated_url: url,
    },
  });
  return { handled: true, reason: "size_availability_storefront_link" };
};

const handleVisualSearchIfMatched = async ({ config, message } = {}) => {
  const [imageAttachment] = imageAttachments(message.attachments || []);
  if (!imageAttachment) return null;
  const imageUrl = text(imageAttachment.url || imageAttachment.image_url || imageAttachment.imageUrl);
  const visualDebug = text(process.env.VISUAL_DEBUG).toLowerCase() === "true";
  const pipeline = {
    attachment_detected: true,
    image_url: imageUrl,
    image_download_success: false,
    image_download_failure: "",
    image_mime_type: "",
    image_bytes: 0,
    openai_vision_request_sent: false,
    raw_vision_response: null,
    normalized_visual_query: "",
    inventory_search_query: "",
    inventory_search_attempts: [],
    indexed_product_images_count: 0,
    exact_image_match_score: 0,
    top_image_matches: [],
    selected_exact_product: null,
    matched_products: [],
    confidence_score: 0,
    fallback_reason: "",
  };
  console.log("ai_inbox_image_search_triggered", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    channel: message.channel,
    image_received: true,
    image_attachment_detected: true,
    image_url: imageUrl,
    image_url_exists: Boolean(imageUrl),
  });
  emitAiInboxEvent(config.tenant_id, "ai_inbox:image_search_triggered", {
    sessionId: message.external_conversation_id,
    channel: message.channel,
  });
  let understanding = null;
  let downloadedImageInput = null;
  try {
    const { token } = await resolveMetaSendConfig({
      tenantId: config.tenant_id,
      channel: message.channel,
      facebookPageId: config.facebook_page_id,
      instagramBusinessAccountId: config.instagram_business_account_id,
      preferredConfigId: config.id,
    });
    const imageInput = await downloadImageForVision({ imageUrl, token });
    downloadedImageInput = imageInput;
    pipeline.image_download_success = true;
    pipeline.image_mime_type = imageInput.mimeType;
    pipeline.image_bytes = imageInput.bytes || imageInput.imageBuffer?.length || 0;
    pipeline.image_download_mode = imageInput.downloadMode || "";
    console.log("ai_inbox_visual_image_download_success", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      image_url: imageUrl,
      image_mime_type: pipeline.image_mime_type,
      image_bytes: pipeline.image_bytes,
      download_mode: pipeline.image_download_mode,
    });
    pipeline.openai_vision_request_sent = true;
    console.log("ai_inbox_visual_openai_request_sent", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      image_mime_type: pipeline.image_mime_type,
      image_bytes: pipeline.image_bytes,
      model: process.env.OPENAI_VISION_MODEL || process.env.AI_SUPPORT_VISION_MODEL || process.env.AI_SUPPORT_MODEL || "",
    });
    understanding = await understandProductImageForSearch({
      ...imageInput,
      imageUrl,
      requestId: `meta:${message.external_message_id || message.dedupe_key || message.external_conversation_id}`,
    });
    pipeline.raw_vision_response = {
      detected: understanding?.detected || {},
      confidence: understanding?.confidence || 0,
      openai_model: understanding?.openai_model || "",
      openai_error: understanding?.openai_error || null,
    };
    console.log("ai_inbox_visual_openai_raw_response", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      raw_vision_response: pipeline.raw_vision_response,
    });
  } catch (error) {
    pipeline.image_download_failure = error?.message || "visual image processing failed";
    pipeline.fallback_reason = "image_download_or_vision_failed";
    console.warn("ai_inbox_visual_image_processing_failed", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      image_url: imageUrl,
      status: error?.status || "",
      code: error?.code || "",
      message: error?.message || "visual image processing failed",
    });
  }
  const visualQuery = visualSearchQueryFromUnderstanding(understanding);
  pipeline.normalized_visual_query = visualQuery;
  const visualAnalysis = visualAnalysisFromUnderstanding(understanding);
  console.log("ai_inbox_visual_json_from_customer_image", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    visual_json: understanding?.detected || {},
    confidence: understanding?.confidence || 0,
  });
  console.log("ai_sales_brain_v2_image_analysis", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    image_analysis: visualAnalysis,
  });
  console.log("ai_inbox_generated_visual_query", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    visual_query: visualQuery,
    confidence: understanding?.confidence || 0,
    openai_model: understanding?.openai_model || "",
  });
  const searchQuery = visualQuery || message.message_text || "sneaker shoe";
  pipeline.inventory_search_query = searchQuery;
  if (visualAnalysis.confidence < 70) {
    pipeline.confidence_score = visualAnalysis.confidence / 100;
    pipeline.fallback_reason = pipeline.fallback_reason || "visual_understanding_confidence_below_70";
    console.log("ai_sales_brain_v2_confidence_decision", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      visual_confidence: visualAnalysis.confidence,
      selected_products: [],
      final_reply_type: "clarification",
      reason: pipeline.fallback_reason,
    });
    await sendAndLogMetaText({
      config,
      message,
      text: VISUAL_CLARIFICATION_REPLY,
      detectedIntent: "visual_search_clarification",
      metadata: { visual_query: searchQuery, confidence_score: visualAnalysis.confidence / 100, fallback_reason: pipeline.fallback_reason, visual_pipeline: pipeline },
    });
    updateConversationMemory(message.external_conversation_id, {
      lastVisualQuery: searchQuery,
      lastVisualConfidence: visualAnalysis.confidence / 100,
      lastVisualReplyType: "clarification",
      lastVisualAnalysis: visualAnalysis,
    });
    return { handled: true, reason: "visual_search_clarification" };
  }
  const indexedSearch = await searchIndexedProductImageMatches({
    tenantId: config.tenant_id,
    detected: understanding?.detected || {},
    visualQuery: searchQuery,
    uploadedImageUrl: imageUrl,
    uploadedImageBuffer: downloadedImageInput?.imageBuffer || null,
  }).catch((error) => {
    console.warn("ai_inbox_visual_index_search_failed", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      message: error?.message || "indexed image search failed",
    });
    return { exactMatch: null, closeMatches: [], searchedCount: 0, topMatches: [], fallbackReason: "visual_index_error" };
  });
  pipeline.indexed_product_images_count = indexedSearch.searchedCount || 0;
  pipeline.exact_image_match_score = Number(indexedSearch.exactMatch?.score || indexedSearch.topMatches?.[0]?.score || 0);
  pipeline.top_image_matches = indexedSearch.topMatches || [];
  console.log("ai_inbox_visual_exact_inventory_match_stage", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    visual_json: understanding?.detected || {},
    searched_indexed_product_images_count: pipeline.indexed_product_images_count,
    exact_image_match_score: pipeline.exact_image_match_score,
    top_image_matches: pipeline.top_image_matches,
    selected_exact_product: indexedSearch.exactMatch
      ? {
          product_id: indexedSearch.exactMatch.product_id,
          variant_id: indexedSearch.exactMatch.variant_id,
          color: indexedSearch.exactMatch.color,
          image_url: indexedSearch.exactMatch.image_url,
          score: indexedSearch.exactMatch.score,
        }
      : null,
    fallback_reason: indexedSearch.fallbackReason || "",
  });
  if (indexedSearch.exactMatch) {
    const exactProducts = await productCardsForIndexedImageMatch({
      tenantId: config.tenant_id,
      match: indexedSearch.exactMatch,
      visualQuery: searchQuery,
    });
    const exactCards = normalizeProductCards(rankStrictVisualProducts({ products: exactProducts, analysis: visualAnalysis }), { limit: 1 });
    if (exactCards.length) {
      const strictScore = Number(exactCards[0].visual_confidence_score || 0) * 100;
      const decision = visualDecisionForConfidence({
        visualConfidence: visualAnalysis.confidence,
        matchConfidence: strictScore,
        hasExact: true,
      });
      console.log("ai_sales_brain_v2_candidate_scores", {
        tenant_id: config.tenant_id,
        conversation_id: message.external_conversation_id,
        candidates: exactCards.map((product) => ({
          product_id: product.product_id || product.id || null,
          name: product.name || "",
          score: Number(product.visual_confidence_score || 0),
          breakdown: product.visual_score_breakdown?.strict_sales_brain_v2 || product.visual_score_breakdown || null,
        })),
      });
      if (decision.limit < 1) {
        console.log("ai_sales_brain_v2_confidence_decision", {
          tenant_id: config.tenant_id,
          conversation_id: message.external_conversation_id,
          visual_confidence: visualAnalysis.confidence,
          match_confidence: strictScore,
          selected_products: [],
          final_reply_type: decision.replyType,
        });
        await sendAndLogMetaText({
          config,
          message,
          text: VISUAL_CLARIFICATION_REPLY,
          detectedIntent: "visual_search_clarification",
          metadata: { visual_query: searchQuery, confidence_score: decision.confidence / 100, fallback_reason: "strict_exact_match_below_threshold", visual_pipeline: pipeline },
        });
        return { handled: true, reason: "visual_search_clarification" };
      }
      pipeline.selected_exact_product = {
        product_id: exactCards[0].product_id,
        name: exactCards[0].name,
        image_url: exactCards[0].image_url,
        score: exactCards[0].visual_confidence_score,
      };
      pipeline.matched_products = exactCards.map((product) => ({
        product_id: product.product_id || product.id || null,
        name: product.name || "",
        confidence: product.visual_confidence_score || 0,
        score_breakdown: product.visual_score_breakdown || null,
      }));
      pipeline.confidence_score = Number(exactCards[0].visual_confidence_score || 0);
      console.log("ai_sales_brain_v2_confidence_decision", {
        tenant_id: config.tenant_id,
        conversation_id: message.external_conversation_id,
        visual_confidence: visualAnalysis.confidence,
        match_confidence: strictScore,
        selected_products: exactCards.map((product) => ({ product_id: product.product_id || product.id || null, name: product.name || "" })),
        final_reply_type: decision.replyType,
      });
      console.log("ai_inbox_visual_exact_inventory_match_selected", {
        tenant_id: config.tenant_id,
        conversation_id: message.external_conversation_id,
        selected_exact_product: pipeline.selected_exact_product,
        top_image_matches: pipeline.top_image_matches,
      });
      await sendAndLogProductCards({
        config,
        message,
        productCards: exactCards,
        detectedIntent: "visual_search_exact_inventory_match",
        introText: "لقيته عندنا ",
        metadata: {
          visual_query: searchQuery,
          confidence_score: pipeline.confidence_score,
          final_reply_type: decision.replyType,
          visual_analysis: visualAnalysis,
          image_search: true,
          exact_inventory_match: true,
          visual_pipeline: pipeline,
        },
      });
      updateConversationMemory(message.external_conversation_id, {
        lastVisualQuery: searchQuery,
        lastVisualConfidence: pipeline.confidence_score,
        lastVisualReplyType: decision.replyType,
        lastVisualAnalysis: visualAnalysis,
      });
      return { handled: true, reason: "visual_search_exact_inventory_match_sent" };
    }
    pipeline.fallback_reason = "exact_index_match_product_card_lookup_failed";
  } else {
    pipeline.fallback_reason = indexedSearch.fallbackReason || "";
  }
  console.log("ai_inbox_visual_inventory_search_query", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    inventory_search_query: searchQuery,
  });
  const searchResult = await searchVisualInventory({
    tenantId: config.tenant_id,
    query: searchQuery,
    metadata: {
      visual_search: true,
      visual_query: searchQuery,
      image_search_query: searchQuery,
    },
    conversationId: message.external_conversation_id,
  });
  pipeline.inventory_search_attempts = searchResult.attempts;
  const ranked = rankStrictVisualProducts({ products: searchResult.products, analysis: visualAnalysis });
  console.log("ai_sales_brain_v2_candidate_scores", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    candidates: ranked.slice(0, 8).map((product) => ({
      product_id: product.product_id || product.id || null,
      name: product.name || "",
      score: Number(product.visual_confidence_score || 0),
      breakdown: product.visual_score_breakdown?.strict_sales_brain_v2 || product.visual_score_breakdown || null,
    })),
  });
  const cards = oneCardPerProduct(normalizeProductCards(ranked, { limit: 4 }));
  const newCards = filterNewProductRecommendations({
    conversationId: message.external_conversation_id,
    productCards: cards,
    allowRepeat: false,
  });
  const topConfidence = Number(cards[0]?.visual_confidence_score || ranked[0]?.visual_confidence_score || 0);
  const decision = visualDecisionForConfidence({
    visualConfidence: visualAnalysis.confidence,
    matchConfidence: topConfidence * 100,
    hasExact: false,
  });
  const selectedCards = (newCards.length ? newCards : cards).slice(0, decision.limit);
  const strongMatch = false;
  pipeline.matched_products = selectedCards.map((product) => ({
    product_id: product.product_id || product.id || null,
    name: product.name || "",
    confidence: product.visual_confidence_score || topConfidence,
    score_breakdown: product.visual_score_breakdown || null,
  }));
  pipeline.confidence_score = topConfidence;
  if (!selectedCards.length) pipeline.fallback_reason = pipeline.fallback_reason || (decision.replyType === "clarification" ? "strict_visual_confidence_below_threshold" : "inventory_search_returned_no_cards");
  else if (!strongMatch) pipeline.fallback_reason = pipeline.fallback_reason || "exact_inventory_match_failed_using_close_visual_alternatives";
  console.log("ai_inbox_visual_search_matched_products", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    generated_visual_query: searchQuery,
    confidence_score: topConfidence,
    matched_products: selectedCards.map((product) => ({
      product_id: product.product_id || product.id || null,
      name: product.name || "",
      confidence: product.visual_confidence_score || topConfidence,
      score_breakdown: product.visual_score_breakdown || null,
    })),
    duplicate_recommendations_prevented: Math.max(0, cards.length - newCards.length),
  });
  console.log("ai_inbox_visual_pipeline_summary", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    ...pipeline,
  });
  console.log("ai_sales_brain_v2_confidence_decision", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    visual_confidence: visualAnalysis.confidence,
    match_confidence: topConfidence * 100,
    selected_products: selectedCards.map((product) => ({ product_id: product.product_id || product.id || null, name: product.name || "" })),
    final_reply_type: decision.replyType,
    limit: decision.limit,
  });
  if (!selectedCards.length) {
    const fallbackDebug = visualDebug
      ? `\n\nDebug:\nquery: ${searchQuery}\nmatched: none\nconfidence: ${topConfidence}`
      : "";
    await sendAndLogMetaText({
      config,
      message,
      text: `${VISUAL_CLARIFICATION_REPLY}${fallbackDebug}`,
      detectedIntent: "visual_search_no_match",
      metadata: { visual_query: searchQuery, confidence_score: topConfidence, fallback_reason: pipeline.fallback_reason, visual_pipeline: pipeline },
    });
    return { handled: true, reason: "visual_search_no_match" };
  }
  const debugText = "";
  if (visualDebug) {
    console.log("ai_inbox_visual_debug_admin_log", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      visual_query: searchQuery,
      top_products: selectedCards.map((product) => product.name),
      confidence: topConfidence,
      pipeline,
    });
  }
  await sendAndLogProductCards({
    config,
    message,
    productCards: selectedCards,
    detectedIntent: "visual_search",
    introText: [decision.replyType === "exact_match" ? "" : VISUAL_CLOSE_MATCH_REPLY, debugText].filter(Boolean).join("\n\n"),
    metadata: {
      visual_query: searchQuery,
      confidence_score: topConfidence,
      image_search: true,
      strong_match: strongMatch,
      fallback_reason: pipeline.fallback_reason,
      final_reply_type: decision.replyType,
      visual_analysis: visualAnalysis,
      visual_pipeline: pipeline,
    },
  });
  updateConversationMemory(message.external_conversation_id, {
    lastVisualQuery: searchQuery,
    lastVisualConfidence: topConfidence,
    lastVisualReplyType: decision.replyType,
    lastVisualAnalysis: visualAnalysis,
  });
  return { handled: true, reason: "visual_search_sent" };
};

const handleHumanHandoffIfMatched = async ({ config, message } = {}) => {
  const keyword = detectHumanHandoff(message.message_text);
  if (!keyword) return null;
  await sendAndLogMetaText({
    config,
    message,
    text: HUMAN_HANDOFF_REPLY,
    detectedIntent: "human_handoff",
    metadata: { handoff_keyword: keyword },
  });
  await markAiSupportConversationEscalated({
    tenantId: config.tenant_id,
    sessionId: message.external_conversation_id,
    reason: "customer_requested_human",
    keyword,
    source: "meta_ai_inbox",
  }).catch(() => {});
  emitAiInboxEvent(config.tenant_id, "ai_inbox:refresh", {
    sessionId: message.external_conversation_id,
    status: "human_takeover",
  });
  emitAiInboxEvent(config.tenant_id, "ai_inbox:human_takeover_requested", {
    sessionId: message.external_conversation_id,
    keyword,
  });
  console.log("ai_inbox_handoff_triggered", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    keyword,
  });
  return { handled: true, reason: "human_handoff" };
};

const handleMoreImagesIfMatched = async ({ config, message } = {}) => {
  const keyword = detectMoreImagesRequest(message.message_text);
  if (!keyword || detectAllColorsRequest(message.message_text) || detectOtherColorsRequest(message.message_text)) return null;
  const context = resolveContextProductCard({ message });
  const baseCard = context.card;
  const includeOtherColors = false;
  console.log("ai_inbox_more_images_requested", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    keyword,
    has_product_context: Boolean(baseCard),
    context_source: context.source || "",
    include_other_colors: includeOtherColors,
  });
  console.log("ai_more_images_context", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    context_source: context.source || "",
    product_id: baseCard?.product_id || null,
    variant_id: baseCard?.variant_id || null,
    color: baseCard?.color || "",
    include_other_colors: includeOtherColors,
  });
  if (context.ambiguous) {
    await sendAndLogMetaText({
      config,
      message,
      text: "\u0635\u0648\u0631 \u0623\u0643\u062a\u0631 \u0644\u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644\u061f",
      detectedIntent: "more_images_color_clarification",
      metadata: { reason: "multiple_product_context", product_card_count: context.cards.length },
    });
    return { handled: true, reason: "more_images_color_clarification" };
  }
  if (!baseCard) {
    await sendAndLogMetaText({
      config,
      message,
      text: "\u0635\u0648\u0631 \u0623\u0643\u062a\u0631 \u0644\u0623\u0646\u0647\u064a \u0645\u0648\u062f\u064a\u0644\u061f",
      detectedIntent: "more_images",
      metadata: { reason: "missing_product_context" },
    });
    return { handled: true, reason: "missing_product_context" };
  }
  lockProductContext({
    conversationId: message.external_conversation_id,
    card: baseCard,
    stage: "product_details",
    reason: "more_images_same_color",
  });
  const product = await loadRememberedProduct({ tenantId: config.tenant_id, card: baseCard, messageText: message.message_text });
  const moreImageCards = normalizeProductCards(await buildMoreImageCards({
    tenantId: config.tenant_id,
    conversationId: message.external_conversation_id,
    product,
    baseCard,
    includeOtherColors: false,
  }), { limit: 4 });
  if (!moreImageCards.length) {
    await sendAndLogMetaText({
      config,
      message,
      text: MORE_IMAGES_EMPTY_REPLY,
      detectedIntent: "more_images",
      metadata: { reason: "no_new_images", product_id: baseCard.product_id || null },
    });
    return { handled: true, reason: "no_new_images" };
  }
  const result = await sendMetaInboxOutboundMessage({
    tenantId: config.tenant_id,
    channel: message.channel,
    recipientId: message.external_customer_id,
    conversationId: message.external_conversation_id,
    productCards: moreImageCards,
    productCardLimit: moreImageCards.length,
    suggestedActions: META_COMMERCE_ACTIONS,
    facebookPageId: config.facebook_page_id,
    instagramBusinessAccountId: config.instagram_business_account_id,
    preferredConfigId: config.id,
  });
  rememberLastProductCards({ conversationId: message.external_conversation_id, productCards: moreImageCards, sentMessages: result?.product_card_messages || [] });
  lockProductContext({
    conversationId: message.external_conversation_id,
    card: baseCard,
    stage: "product_details",
    reason: "same_color_images_sent",
  });
  console.log("ai_same_color_images", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    product_id: baseCard.product_id || null,
    variant_id: baseCard.variant_id || null,
    color: baseCard.color || "",
    image_count: moreImageCards.length,
  });
  const preview = moreImageCards.map(productCardReplyText).join("\n\n").slice(0, 500);
  await appendAiGeneratedSupportReply({
    tenantId: config.tenant_id,
    sessionId: message.external_conversation_id,
    answer: preview,
    detectedIntent: "more_images",
    suggestedProducts: moreImageCards,
    suggestedActions: META_COMMERCE_ACTIONS,
    channel: message.channel,
    deliveryStatus: "sent",
    externalMessageId: result?.message_id || "",
  }).catch(() => {});
  await logChannelEvent({
    tenantId: config.tenant_id,
    channel: message.channel,
    direction: "outbound",
    externalCustomerId: message.external_customer_id,
    conversationId: message.external_conversation_id,
    messagePreview: preview,
    status: "sent",
    metadata: { meta_message_id: result?.message_id || "", product_card_count: moreImageCards.length, more_images: true },
  }).catch(() => {});
  return { handled: true, reason: "more_images_sent" };
};

const handleAlternativesIfMatched = async ({ config, message } = {}) => {
  const keyword = detectAlternativesRequest(message.message_text);
  if (!keyword) return null;
  const memory = getConversationMemory(message.external_conversation_id) || {};
  const baseCard = lastProductCardFromMemory(message.external_conversation_id);
  const query = text(memory.lastVisualQuery || baseCard?.name || message.message_text);
  if (!query) return null;
  unlockProductContext({
    conversationId: message.external_conversation_id,
    reason: "alternatives_requested",
  });
  const analysis = memory.lastVisualAnalysis || {
    brand: baseCard?.name || "",
    modelFamily: baseCard?.name || "",
    confidence: Math.max(70, Number(memory.lastVisualConfidence || 0) * 100),
  };
  const searchResult = await searchVisualInventory({
    tenantId: config.tenant_id,
    query,
    metadata: { visual_search: true, allow_alternatives: true, visual_query: query },
    conversationId: message.external_conversation_id,
  });
  const currentId = String(baseCard?.product_id || "");
  const ranked = rankStrictVisualProducts({ products: searchResult.products, analysis })
    .filter((product) => String(product.product_id || product.id || "") !== currentId);
  const cards = oneCardPerProduct(normalizeProductCards(ranked, { limit: 4 })).slice(0, 2);
  console.log("ai_sales_brain_v2_alternatives", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    query,
    selected_products: cards.map((product) => ({
      product_id: product.product_id || product.id || null,
      name: product.name || "",
      score: Number(product.visual_confidence_score || 0),
    })),
    final_reply_type: cards.length ? "close_match" : "no_match",
  });
  if (!cards.length) {
    await sendAndLogMetaText({
      config,
      message,
      text: VISUAL_CLARIFICATION_REPLY,
      detectedIntent: "visual_alternatives_no_match",
      metadata: { visual_query: query, keyword },
    });
    return { handled: true, reason: "visual_alternatives_no_match" };
  }
  await sendAndLogProductCards({
    config,
    message,
    productCards: cards,
    detectedIntent: "visual_alternatives",
    introText: VISUAL_CLOSE_MATCH_REPLY,
    metadata: { visual_query: query, allow_alternatives: true, final_reply_type: "close_match" },
  });
  return { handled: true, reason: "visual_alternatives_sent" };
};

const handleOtherColorsIfMatched = async ({ config, message } = {}) => {
  if (!detectOtherColorsRequest(message.message_text) && !detectAllColorsRequest(message.message_text)) return null;
  const context = resolveContextProductCard({ message, allowAmbiguous: true });
  const baseCard = context.card;
  if (!baseCard) return null;
  const product = await loadRememberedProduct({ tenantId: config.tenant_id, card: baseCard, messageText: baseCard.name || message.message_text });
  if (!product) return null;
  const limit = 3;
  const cards = normalizeProductCards([product], { limit })
    .filter((card) => imageIdentity(card.image_url) !== imageIdentity(baseCard.image_url) || text(card.color).toLowerCase() !== text(baseCard.color).toLowerCase())
    .slice(0, limit);
  console.log("ai_model_color_limit_applied", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    requested_limit: limit,
    resulting_card_count: cards.length,
    all_colors_requested: detectAllColorsRequest(message.message_text || ""),
    other_colors_requested: detectOtherColorsRequest(message.message_text || ""),
  });
  if (!cards.length) {
    await sendAndLogMetaText({
      config,
      message,
      text: "\u0645\u0634 \u0644\u0627\u0642\u064a \u0623\u0644\u0648\u0627\u0646 \u062a\u0627\u0646\u064a\u0629 \u0645\u062a\u0627\u062d\u0629 \u0644\u0644\u0645\u0648\u062f\u064a\u0644 \u062f\u0647 \u062f\u0644\u0648\u0642\u062a\u064a.",
      detectedIntent: "other_colors_empty",
      metadata: { product_id: baseCard.product_id || null },
    });
    return { handled: true, reason: "other_colors_empty" };
  }
  await sendAndLogProductCards({
    config,
    message,
    productCards: cards,
    detectedIntent: "other_colors",
    metadata: { product_card_limit: limit, other_colors_requested: true },
  });
  return { handled: true, reason: "other_colors_sent" };
};

const handleSizesIfMatched = async ({ config, message } = {}) => {
  const keyword = detectSizesRequest(message.message_text);
  if (!keyword) return null;
  const context = resolveContextProductCard({ message });
  const baseCard = context.card;
  if (!baseCard) return null;
  const memory = getConversationMemory(message.external_conversation_id) || {};
  const requestedSize = extractShoeSize(message.message_text) || "";
  const rememberedCards = Array.isArray(memory.lastProductCards) ? memory.lastProductCards : [];
  if (context.ambiguous || (requestedSize && rememberedCards.length > 1 && !memory.selectedProductId)) {
    await sendAndLogMetaText({
      config,
      message,
      text: colorsClarificationText(rememberedCards) || MULTIPLE_PRODUCT_CLARIFICATION_REPLY,
      detectedIntent: "multiple_product_size_clarification",
      metadata: { requested_size: requestedSize, product_card_count: rememberedCards.length },
    });
    updateConversationMemory(message.external_conversation_id, {
      pendingSizeForProductChoice: requestedSize,
      checkoutStage: "product_details",
    });
    return { handled: true, reason: "multiple_product_size_clarification" };
  }
  const product = await loadRememberedProduct({ tenantId: config.tenant_id, card: baseCard, messageText: message.message_text });
  const sizes = availableSizesForProduct(product, baseCard);
  const colorLabel = text(baseCard.color);
  const replyText = sizes.length
    ? `\u0627\u0644\u0645\u062a\u0627\u062d ${colorLabel ? `\u0641\u064a \u0627\u0644\u0644\u0648\u0646 ${colorLabel}` : "\u0641\u064a \u0627\u0644\u0644\u0648\u0646 \u062f\u0647"}: ${sizes.join("\u060c ")}.\n\u062a\u062d\u0628 \u0623\u0634\u0648\u0641\u0644\u0643 \u0635\u0648\u0631 \u0625\u0636\u0627\u0641\u064a\u0629 \u0644\u0646\u0641\u0633 \u0627\u0644\u0644\u0648\u0646\u061f\n\u0648\u0644\u0627 \u0623\u0648\u0631\u064a\u0643 \u0628\u0627\u0642\u064a \u0627\u0644\u0623\u0644\u0648\u0627\u0646\u061f`
    : "\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0645\u0634 \u0648\u0627\u0636\u062d\u0629 \u0639\u0646\u062f\u064a \u0644\u0644\u0648\u0646 \u062f\u0647\u060c \u0623\u0631\u0627\u062c\u0639\u0647\u0627\u0644\u0643\u061f";
  updateConversationMemory(message.external_conversation_id, {
    checkoutStage: "product_details",
    contextLocked: true,
    selectedProductId: baseCard.product_id || baseCard.id || null,
    selectedVariantId: baseCard.variant_id || null,
    selectedColor: baseCard.color || "",
  });
  console.log("ai_checkout_blocked", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    checkout_stage: "product_details",
    trigger: "sizes_request",
    reason: "size_question_is_product_detail",
  });
  console.log("ai_context_locked", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    reason: "sizes_request",
    checkout_stage: "product_details",
    product_id: baseCard.product_id || baseCard.id || null,
    variant_id: baseCard.variant_id || null,
    color: baseCard.color || "",
  });
  await sendAndLogMetaText({
    config,
    message,
    text: replyText,
    detectedIntent: "sizes_request",
    metadata: { checkout_stage: "product_details", sizes },
  });
  return { handled: true, reason: "sizes_answered" };
};

const handleContextualSizeCheckIfMatched = async ({ config, message } = {}) => {
  const requestedSize = extractShoeSize(message.message_text);
  const availabilityKeyword = hasTerm(message.message_text, ["\u0645\u062a\u0648\u0641\u0631", "\u0641\u064a\u0647", "\u0641\u064a", "\u0645\u0648\u062c\u0648\u062f", "available"]);
  if (!requestedSize && !availabilityKeyword) return null;
  const context = resolveContextProductCard({ message });
  if (!context.card && !context.ambiguous) return null;
  if (context.ambiguous) {
    await sendAndLogMetaText({
      config,
      message,
      text: colorsClarificationText(context.cards),
      detectedIntent: "size_check_color_clarification",
      metadata: { requested_size: requestedSize || "", product_card_count: context.cards.length },
    });
    return { handled: true, reason: "size_check_color_clarification" };
  }
  const baseCard = context.card;
  const sizes = [...new Set((Array.isArray(baseCard.sizes) ? baseCard.sizes : baseCard.available_sizes || []).map(text).filter(Boolean))];
  const colorLabel = text(baseCard.color);
  const colorPhrase = colorLabel ? `\u0627\u0644\u0644\u0648\u0646 ${colorLabel}` : "\u0627\u0644\u0644\u0648\u0646 \u062f\u0647";
  if (!requestedSize) {
    lockProductContext({
      conversationId: message.external_conversation_id,
      card: baseCard,
      stage: "product_details",
      reason: "availability_check",
    });
    await sendAndLogMetaText({
      config,
      message,
      text: sizes.length
        ? `\u0623\u064a\u0648\u0647\u060c \u0627\u0644\u0645\u062a\u0627\u062d \u0641\u064a ${colorPhrase}: ${sizes.join("\u060c ")}`
        : "\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0645\u0634 \u0648\u0627\u0636\u062d\u0629 \u0639\u0646\u062f\u064a \u0644\u0644\u0648\u0646 \u062f\u0647\u060c \u0623\u0631\u0627\u062c\u0639\u0647\u0627\u0644\u0643\u061f",
      detectedIntent: "contextual_availability_check",
      metadata: { product_id: baseCard.product_id || null, variant_id: baseCard.variant_id || null, color: baseCard.color || "", sizes },
    });
    return { handled: true, reason: "contextual_availability_answered" };
  }
  const requestedDigits = sizeDigits(requestedSize);
  const hasSize = sizes.some((size) => sizeDigits(size) === requestedDigits);
  const replyText = hasSize
    ? `\u0623\u064a\u0648\u0647\u060c \u0645\u0642\u0627\u0633 ${requestedSize} \u0645\u062a\u0648\u0641\u0631 \u0641\u064a ${colorPhrase} \u2705\n\n\u062a\u062d\u0628 \u0623\u0634\u0648\u0641\u0644\u0643 \u0635\u0648\u0631 \u0625\u0636\u0627\u0641\u064a\u0629 \u0644\u0646\u0641\u0633 \u0627\u0644\u0644\u0648\u0646\u061f\n\u0648\u0644\u0627 \u0623\u0648\u0631\u064a\u0643 \u0628\u0627\u0642\u064a \u0627\u0644\u0623\u0644\u0648\u0627\u0646\u061f`
    : sizes.length
      ? `\u0644\u0644\u0623\u0633\u0641 ${requestedSize} \u0645\u0634 \u0645\u062a\u0648\u0641\u0631 \u0641\u064a ${colorPhrase}\u060c \u0627\u0644\u0645\u062a\u0627\u062d: ${sizes.join("\u060c ")}`
      : "\u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062a \u0645\u0634 \u0648\u0627\u0636\u062d\u0629 \u0639\u0646\u062f\u064a \u0644\u0644\u0648\u0646 \u062f\u0647\u060c \u0623\u0631\u0627\u062c\u0639\u0647\u0627\u0644\u0643\u061f";
  lockProductContext({
    conversationId: message.external_conversation_id,
    card: baseCard,
    stage: "product_details",
    reason: "contextual_size_check",
  });
  if (hasSize) updateConversationMemory(message.external_conversation_id, { selectedSize: requestedSize });
  console.log("ai_checkout_blocked", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    reason: "size_check_is_product_detail",
    checkout_stage: "product_details",
    requested_size: requestedSize,
  });
  console.log("ai_size_check_result", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    context_source: context.source || "",
    product_id: baseCard.product_id || null,
    variant_id: baseCard.variant_id || null,
    color: baseCard.color || "",
    requested_size: requestedSize,
    available_sizes: sizes,
    available: hasSize,
  });
  await sendAndLogMetaText({
    config,
    message,
    text: replyText,
    detectedIntent: hasSize ? "contextual_size_available" : "contextual_size_unavailable",
    metadata: { product_id: baseCard.product_id || null, variant_id: baseCard.variant_id || null, color: baseCard.color || "", requested_size: requestedSize, available_sizes: sizes, available: hasSize },
  });
  return { handled: true, reason: hasSize ? "contextual_size_available" : "contextual_size_unavailable" };
};

const ensureCheckoutDraftForMemory = async ({ config, message, memory = {}, selectedSize = "" } = {}) => {
  if (memory.orderDraftId) return { order_id: memory.orderDraftId, created: false, reason: "existing_order_draft" };
  const baseCard = lastProductCardFromMemory(message.external_conversation_id);
  if (!baseCard) return { order_id: null, created: false, reason: "missing_product_card" };
  const product = await loadRememberedProduct({ tenantId: config.tenant_id, card: baseCard, messageText: message.message_text });
  if (!product) return { order_id: null, created: false, reason: "missing_product" };
  const variant = chooseVariantForSize(product, selectedSize, memory.selectedVariantId || baseCard.variant_id);
  if (!variant) return { order_id: null, created: false, reason: "missing_variant" };
  const selectedColor = variant.color || memory.selectedColor || baseCard.color || "";
  const draft = await createAiOrderDraft({
    tenant_id: config.tenant_id,
    channel: channelAlias(message.channel),
    source: channelAlias(message.channel),
    conversation_id: message.external_conversation_id,
    session_id: message.external_conversation_id,
    external_customer_id: message.external_customer_id,
    customer_phone: message.external_customer_id,
    customer_name: message.customer_name || "",
    allow_missing_phone: true,
    product,
    variant,
    size: selectedSize,
    color: selectedColor,
    original_customer_message: message.message_text,
    metadata: {
      source: channelAlias(message.channel),
      status: "pending_checkout_info",
      allow_missing_phone: true,
      external_customer_id: message.external_customer_id,
      sales_intent: "confirmed_booking_after_size",
    },
  });
  return {
    order_id: draft?.order?.id || null,
    product_id: product.id || baseCard.product_id || null,
    variant_id: variant.id || baseCard.variant_id || null,
    selected_color: selectedColor,
    created: Boolean(draft?.order?.id),
    reason: "created_order_draft",
  };
};

const handleCheckoutContinuationIfMatched = async ({ config, message } = {}) => {
  const memory = getConversationMemory(message.external_conversation_id) || {};
  const decision = evaluateMetaCheckoutContinuation({ memory, messageText: message.message_text });
  if (!decision.handled) return null;

  let draftResult = { order_id: memory.orderDraftId || null, created: false, reason: "not_needed" };
  if (decision.nextCheckoutStage === "checkout") {
    draftResult = await ensureCheckoutDraftForMemory({
      config,
      message,
      memory,
      selectedSize: decision.selectedSize,
    }).catch((error) => ({
      order_id: memory.orderDraftId || null,
      created: false,
      reason: error?.message || "draft_creation_failed",
    }));
  }

  const nextMemory = updateConversationMemory(message.external_conversation_id, {
    selectedProductId: memory.selectedProductId || memory.lastProductCard?.product_id || draftResult.product_id || null,
    selectedVariantId: memory.selectedVariantId || memory.lastProductCard?.variant_id || draftResult.variant_id || null,
    selectedColor: memory.selectedColor || memory.lastProductCard?.color || draftResult.selected_color || "",
    selectedSize: decision.selectedSize,
    checkoutStage: decision.nextCheckoutStage,
    bookingConfirmationAsked: true,
    buyIntentDetected: true,
    orderDraftId: draftResult.order_id || memory.orderDraftId || null,
  });

  console.log("ai_inbox_checkout_continuation", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    incoming_message: message.message_text,
    selected_size: decision.selectedSize,
    previous_checkout_stage: decision.previousCheckoutStage,
    next_checkout_stage: decision.nextCheckoutStage,
    booking_confirmation_asked_before: memory.bookingConfirmationAsked === true,
    booking_confirmation_asked_after: nextMemory?.bookingConfirmationAsked === true,
    selected_product_id: nextMemory?.selectedProductId || null,
    selected_variant_id: nextMemory?.selectedVariantId || null,
    branch_chosen: decision.branch,
    generic_size_flow_skipped: true,
    generic_size_flow_skipped_reason: decision.skipGenericSizeFlowReason || "checkout_continuation",
    order_id: draftResult.order_id || null,
    draft_reason: draftResult.reason || "",
  });

  await sendAndLogMetaText({
    config,
    message,
    text: decision.replyText,
    detectedIntent: decision.nextCheckoutStage === "checkout" ? "checkout_info_requested" : "booking_confirmation_requested",
    metadata: {
      previous_checkout_stage: decision.previousCheckoutStage,
      checkout_stage: decision.nextCheckoutStage,
      selected_size: decision.selectedSize,
      selected_product_id: nextMemory?.selectedProductId || null,
      selected_variant_id: nextMemory?.selectedVariantId || null,
      booking_confirmation_asked: true,
      branch_chosen: decision.branch,
      generic_size_flow_skipped: true,
      generic_size_flow_skipped_reason: decision.skipGenericSizeFlowReason || "checkout_continuation",
      order_id: draftResult.order_id || null,
    },
  });
  return { handled: true, reason: decision.branch };
};

const handleOrderDraftIfMatched = async ({ config, message } = {}) => {
  const explicitCheckoutIntent = detectExplicitCheckoutIntent(message.message_text);
  if (!explicitCheckoutIntent) {
    if (detectProductDetailQuestion(message.message_text)) {
      console.log("ai_checkout_blocked", {
        tenant_id: config.tenant_id,
        conversation_id: message.external_conversation_id,
        reason: "product_detail_message_without_buying_intent",
        message_text: message.message_text || "",
      });
    }
    return null;
  }
  console.log("ai_checkout_trigger", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    message_text: message.message_text || "",
  });
  const memory = getConversationMemory(message.external_conversation_id) || {};
  const previousCheckoutStage = text(memory.checkoutStage || "browsing");
  const selectedSizeFromMemory = text(memory.selectedSize || "");
  const confirmationDetected = detectCheckoutConfirmation(message.message_text);
  const explicitSizeChange = detectExplicitSizeChange(message.message_text);
  const requestedSize = extractShoeSize(message.message_text) || "";
  const sizeFlowReopenedReason = explicitSizeChange
    ? "explicit_size_change"
    : !checkoutStageAtLeast(previousCheckoutStage, "product_details")
      ? "stage_before_product_details"
      : "";
  if (
    confirmationDetected &&
    selectedSizeFromMemory &&
    checkoutStageAtLeast(previousCheckoutStage, "product_details") &&
    !explicitSizeChange
  ) {
    const nextMemory = updateConversationMemory(message.external_conversation_id, {
      checkoutStage: "checkout",
      selectedSize: selectedSizeFromMemory,
      selectedProductId: memory.selectedProductId || memory.lastProductCard?.product_id || null,
      selectedVariantId: memory.selectedVariantId || memory.lastProductCard?.variant_id || null,
      selectedColor: memory.selectedColor || memory.lastProductCard?.color || "",
      bookingConfirmationAsked: true,
      buyIntentDetected: true,
    });
    console.log("ai_inbox_checkout_stage_transition", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      previous_checkout_stage: previousCheckoutStage,
      next_checkout_stage: nextMemory?.checkoutStage || "checkout",
      selected_product_id: nextMemory?.selectedProductId || null,
      selected_variant_id: nextMemory?.selectedVariantId || null,
      selected_size: selectedSizeFromMemory,
      selected_color: nextMemory?.selectedColor || "",
      confirmation_detected: true,
      buy_intent_detected: true,
      size_flow_reopened: false,
      size_flow_reopened_reason: "",
    });
    await sendAndLogMetaText({
      config,
      message,
      text: CHECKOUT_INFO_COLLECTION_REPLY,
      detectedIntent: "checkout_info_requested",
      metadata: {
        previous_checkout_stage: previousCheckoutStage,
        checkout_stage: "checkout",
        selected_size: selectedSizeFromMemory,
        selected_product_id: nextMemory?.selectedProductId || null,
        selected_variant_id: nextMemory?.selectedVariantId || null,
      },
    });
    return { handled: true, reason: "checkout_info_requested_after_confirmation" };
  }
  const context = resolveContextProductCard({ message });
  if (context.ambiguous) {
    await sendAndLogMetaText({
      config,
      message,
      text: colorsClarificationText(context.cards),
      detectedIntent: "order_color_clarification",
      metadata: { product_card_count: context.cards.length },
    });
    return { handled: true, reason: "order_color_clarification" };
  }
  const baseCard = context.card;
  if (!baseCard) return null;
  const product = await loadRememberedProduct({ tenantId: config.tenant_id, card: baseCard, messageText: message.message_text });
  if (!product) return null;
  const availableSizes = availableSizesForProduct(product, baseCard);
  if (!requestedSize && availableSizes.length > 1 && !checkoutStageAtLeast(previousCheckoutStage, "product_details")) {
    updateConversationMemory(message.external_conversation_id, {
      checkoutStage: "buying_intent",
      selectedProductId: product.id || baseCard.product_id || null,
      selectedVariantId: baseCard.variant_id || null,
      selectedColor: baseCard.color || "",
      buyIntentDetected: true,
    });
    console.log("ai_inbox_checkout_stage", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      previous_checkout_stage: previousCheckoutStage,
      next_checkout_stage: "buying_intent",
      checkout_stage: "buying_intent",
      trigger: "buying_intent_without_size",
      selected_size: selectedSizeFromMemory,
      size_flow_reopened: true,
      size_flow_reopened_reason: sizeFlowReopenedReason || "missing_size_before_product_details",
    });
    emitAiInboxEvent(config.tenant_id, "ai_inbox:checkout_started", {
      sessionId: message.external_conversation_id,
      checkout_stage: "buying_intent",
    });
    await sendAndLogMetaText({
      config,
      message,
      text: `تمام، تحب مقاس كام؟\nالمتاح: ${availableSizes.join("، ")}.`,
      detectedIntent: "checkout_select_size",
      metadata: { checkout_stage: "buying_intent", sizes: availableSizes },
    });
    return { handled: true, reason: "checkout_size_requested" };
  }
  if (!requestedSize && availableSizes.length > 1 && checkoutStageAtLeast(previousCheckoutStage, "product_details")) {
    console.log("ai_inbox_checkout_size_flow_blocked", {
      tenant_id: config.tenant_id,
      conversation_id: message.external_conversation_id,
      previous_checkout_stage: previousCheckoutStage,
      selected_size: selectedSizeFromMemory,
      confirmation_detected: confirmationDetected,
      explicit_size_change: explicitSizeChange,
      size_flow_reopened: false,
      size_flow_reopened_reason: "",
    });
    return null;
  }
  const effectiveSize = requestedSize || selectedSizeFromMemory || availableSizes[0] || "";
  const variant = chooseVariantForSize(product, effectiveSize, baseCard.variant_id);
  console.log("ai_inbox_selected_variant", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    product_id: product.id || baseCard.product_id || null,
    variant_id: variant?.id || null,
    requested_size: effectiveSize,
  });
  if (!variant) {
    await sendAndLogMetaText({
      config,
      message,
    text: effectiveSize ? `مقاس ${effectiveSize} مش ظاهر متاح عندي دلوقتي. تحب أطلعلك أقرب مقاس؟` : "المقاس ده مش ظاهر متاح عندي دلوقتي.",
      detectedIntent: "selected_size_unavailable",
      metadata: { requested_size: effectiveSize, checkout_stage: "buying_intent" },
    });
    return { handled: true, reason: "selected_size_unavailable" };
  }
  const selectedSize = effectiveSize || variant.size || "";
  const selectedColor = variant.color || baseCard.color || "";
  const signals = await productSalesSignals({ tenantId: config.tenant_id, productId: product.id, variant });
  const closerLine = closerLineForProduct(signals);
  updateConversationMemory(message.external_conversation_id, {
    selectedProductId: product.id || baseCard.product_id || null,
    selectedVariantId: variant.id || baseCard.variant_id || null,
    selectedSize,
    selectedColor,
    checkoutStage: "buying_intent",
    bookingConfirmationAsked: true,
    buyIntentDetected: true,
  });
  console.log("ai_inbox_selected_size", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    product_id: product.id || null,
    variant_id: variant.id || null,
    selected_size: selectedSize,
    selected_color: selectedColor,
  });
  console.log("ai_inbox_checkout_stage", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    previous_checkout_stage: previousCheckoutStage,
    next_checkout_stage: "buying_intent",
    checkout_stage: "buying_intent",
    trigger: "size_selected",
    selected_product_id: product.id || null,
    selected_variant_id: variant.id || null,
    selected_size: selectedSize,
    selected_color: selectedColor,
    booking_confirmation_asked: true,
    size_flow_reopened: Boolean(explicitSizeChange),
    size_flow_reopened_reason: explicitSizeChange ? "explicit_size_change" : "",
  });
  const draft = await createAiOrderDraft({
    tenant_id: config.tenant_id,
    channel: channelAlias(message.channel),
    source: channelAlias(message.channel),
    conversation_id: message.external_conversation_id,
    session_id: message.external_conversation_id,
    external_customer_id: message.external_customer_id,
    customer_phone: message.external_customer_id,
    customer_name: message.customer_name || "",
    allow_missing_phone: true,
    product,
    variant,
    size: selectedSize,
    color: selectedColor,
    original_customer_message: message.message_text,
    metadata: {
      source: channelAlias(message.channel),
      status: "pending_confirmation",
      allow_missing_phone: true,
      external_customer_id: message.external_customer_id,
      sales_intent: "buy_from_last_product_card",
    },
  });
  console.log("ai_inbox_order_draft_created", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    order_id: draft?.order?.id || null,
    product_id: product.id || null,
    variant_id: variant.id || null,
    status: "pending_confirmation",
  });
  updateConversationMemory(message.external_conversation_id, {
    orderDraftId: draft?.order?.id || null,
  });
  console.log("ai_inbox_booking_confirmation_requested", {
    tenant_id: config.tenant_id,
    conversation_id: message.external_conversation_id,
    checkout_stage: "buying_intent",
    booking_confirmation_asked: true,
    order_id: draft?.order?.id || null,
  });
  emitAiInboxEvent(config.tenant_id, "ai_inbox:checkout_started", {
    sessionId: message.external_conversation_id,
    checkout_stage: "buying_intent",
    product_id: product.id || null,
    variant_id: variant.id || null,
  });
  emitAiInboxEvent(config.tenant_id, "ai_inbox:draft_order_created", {
    sessionId: message.external_conversation_id,
    order_id: draft?.order?.id || null,
    product_id: product.id || null,
    variant_id: variant.id || null,
  });
  await sendAndLogMetaText({
    config,
    message,
    legacyText: selectedSize
      ? `تمام، متوفر مقاس ${selectedSize}.\n${closerLine}\n\nابعت:\n- الاسم\n- رقم الموبايل\n- العنوان\nعشان أجهز الطلب`
      : ORDER_DRAFT_REPLY,
    text: selectedSize ? `${bookingConfirmationPrompt(selectedSize)}${closerLine ? `\n${closerLine}` : ""}` : ORDER_DRAFT_REPLY,
    detectedIntent: "booking_confirmation_requested",
    metadata: {
      order_id: draft?.order?.id || null,
      product_id: product.id || null,
      variant_id: variant.id || null,
      selected_size: selectedSize,
      selected_color: selectedColor,
      checkout_stage: "buying_intent",
      booking_confirmation_asked: true,
      status: "pending_confirmation",
    },
  });
  return { handled: true, reason: "booking_confirmation_requested" };
};

const recordLeadSignals = async ({ config, message, reason = "inbound" } = {}) => {
  const conversationId = message.external_conversation_id;
  const memory = getConversationMemory(conversationId) || {};
  const current = memory.leadSignals && typeof memory.leadSignals === "object" ? memory.leadSignals : {};
  const next = {
    messageCount: Number(current.messageCount || 0) + 1,
    sizeQuestions: Number(current.sizeQuestions || 0) + (detectSizesRequest(message.message_text) || extractShoeSize(message.message_text) ? 1 : 0),
    paymentQuestions: Number(current.paymentQuestions || 0) + (detectFaqIntent(message.message_text) === "payment" ? 1 : 0),
    shippingQuestions: Number(current.shippingQuestions || 0) + (detectShippingQuestion(message.message_text) ? 1 : 0),
    orderIntent: Number(current.orderIntent || 0) + (detectBuyingIntent(message.message_text) ? 1 : 0),
    productViews: Math.max(Number(current.productViews || 0), Array.isArray(memory.viewedProductIds) ? memory.viewedProductIds.length : 0),
  };
  const score = Math.min(100,
    Math.min(next.messageCount, 6) * 6 +
    Math.min(next.sizeQuestions, 3) * 14 +
    Math.min(next.paymentQuestions, 2) * 12 +
    Math.min(next.shippingQuestions, 2) * 10 +
    Math.min(next.orderIntent, 3) * 18 +
    Math.min(next.productViews, 5) * 6
  );
  updateConversationMemory(conversationId, {
    leadSignals: next,
    hotLead: score >= HOT_LEAD_THRESHOLD,
    hotLeadScore: score,
  });
  if (score >= HOT_LEAD_THRESHOLD && memory.hotLeadNotified !== true) {
    updateConversationMemory(conversationId, { hotLeadNotified: true });
    await updateHotLeadState({
      tenantId: config.tenant_id,
      conversationId,
      score,
      reason,
      insight: HOT_LEAD_INSIGHT,
    });
  } else if (score >= HOT_LEAD_THRESHOLD) {
    await updateHotLeadState({
      tenantId: config.tenant_id,
      conversationId,
      score,
      reason,
      insight: HOT_LEAD_INSIGHT,
    });
  }
  return { score, signals: next };
};

const resolveMetaSendConfig = async ({
  tenantId,
  channel = "",
  facebookPageId = "",
  instagramBusinessAccountId = "",
  preferredConfigId = null,
} = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const normalizedChannel = adapterChannel(channelAlias(channel) === "instagram" || channel === AI_AGENT_CHANNELS.INSTAGRAM ? "instagram" : "facebook");
  const pageId = text(facebookPageId);
  const igId = text(instagramBusinessAccountId);
  const preferredId = numberOrNull(preferredConfigId);
  if (!scopedTenantId) {
    throw Object.assign(new Error("tenant_id is required for Meta send config lookup"), { status: 400, code: "META_SEND_TENANT_REQUIRED" });
  }

  const result = await db.query(
    `
    SELECT *
    FROM meta_integration_configs
    WHERE tenant_id = $1
      AND page_access_token_encrypted IS NOT NULL
      AND page_access_token_encrypted <> ''
      AND COALESCE(token_expires_at, NOW() + INTERVAL '1 day') > NOW()
      AND LOWER(COALESCE(status, '')) NOT IN ('invalid','token_expired','revoked','error','not_connected')
      AND (
        $5::text <> 'instagram'
        OR COALESCE(instagram_business_account_id, '') <> ''
        OR $4::text <> ''
      )
    ORDER BY
      CASE WHEN $2::bigint IS NOT NULL AND id = $2::bigint THEN 0 ELSE 1 END,
      CASE WHEN $3::text <> '' AND TRIM(COALESCE(facebook_page_id, '')::text) = $3 THEN 0 ELSE 1 END,
      CASE WHEN $4::text <> '' AND TRIM(COALESCE(instagram_business_account_id, '')::text) = $4 THEN 0 ELSE 1 END,
      CASE WHEN webhook_enabled = TRUE THEN 0 ELSE 1 END,
      updated_at DESC,
      id DESC
    LIMIT 10
    `,
    [scopedTenantId, preferredId, pageId, igId, normalizedChannel === AI_AGENT_CHANNELS.INSTAGRAM ? "instagram" : "facebook"]
  );
  const marketingResult = await db.query(
    `
    SELECT *
    FROM marketing_settings
    WHERE tenant_id = $1
      AND (COALESCE(page_access_token, '') <> '' OR COALESCE(access_token_encrypted, '') <> '')
      AND ($2::text = '' OR COALESCE(page_id, '') = '' OR TRIM(page_id::text) = $2)
      AND ($3::text = '' OR COALESCE(instagram_account_id, '') = '' OR TRIM(instagram_account_id::text) = $3)
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [scopedTenantId, pageId, igId]
  ).catch(() => ({ rows: [] }));

  const candidates = [
    ...result.rows.map((row) => ({ source: "meta_integration_configs", row })),
    ...marketingResult.rows.map((row) => ({
      source: "marketing_settings",
      row: {
        id: null,
        tenant_id: row.tenant_id,
        facebook_page_id: row.page_id || pageId,
        instagram_business_account_id: row.instagram_account_id || igId,
        page_access_token_encrypted: row.page_access_token || row.access_token_encrypted || "",
        token_expires_at: row.token_expires_at || null,
        status: row.token_status || "active",
        webhook_enabled: false,
      },
    })),
  ];

  let decryptFailures = 0;
  for (const candidate of candidates) {
    const { row } = candidate;
    const decrypted = tryDecryptSecret(row.page_access_token_encrypted, {
      tenant_id: scopedTenantId,
      config_id: row.id || null,
      source: candidate.source,
      channel: normalizedChannel,
    });
    if (!decrypted.value) {
      if (decrypted.error) decryptFailures += 1;
      continue;
    }
    console.log("[meta-inbox] meta_send_config_resolved", {
      tenant_id: scopedTenantId,
      config_id: row.id || null,
      source: candidate.source,
      channel: normalizedChannel,
      facebook_page_id: maskIdForLog(row.facebook_page_id || pageId),
      instagram_business_account_id: maskIdForLog(row.instagram_business_account_id || igId),
      token_expires_at: row.token_expires_at || null,
      decrypt_failures_before_selected: decryptFailures,
    });
    return { config: row, token: decrypted.value, source: candidate.source, channel: normalizedChannel };
  }

  throw Object.assign(new Error(decryptFailures ? "No decryptable active Meta token found for this tenant/account." : "No active persisted Meta integration config found for this tenant/account."), {
    status: 409,
    code: decryptFailures ? "META_TOKEN_DECRYPT_FAILED" : "META_CONFIG_MISSING",
  });
};

const resolveMessengerRecipientPsid = ({ recipientId = "", conversationId = "", config = {}, facebookPageId = "" } = {}) => {
  let safeRecipientId = text(recipientId);
  const pageIds = new Set([
    text(facebookPageId),
    text(config.facebook_page_id),
    text(config.page_id),
  ].filter(Boolean));
  const conversationSuffix = text(conversationId).includes(":") ? text(conversationId).split(":").pop() : "";
  const resolved = safeRecipientId;
  const recipientIsPage = pageIds.has(resolved) || (conversationSuffix && pageIds.has(conversationSuffix) && resolved === conversationSuffix);
  console.log("ai_inbox_recipient_resolution", {
    channel: AI_AGENT_CHANNELS.FACEBOOK_MESSENGER,
    conversation_id: conversationId || "",
    resolved_recipient_psid: maskIdForLog(resolved),
    resolved_page_id: maskIdForLog([...pageIds][0] || ""),
    resolved_customer_id: maskIdForLog(resolved),
    resolved_sender_id: maskIdForLog(resolved),
    recipient_matches_page_id: recipientIsPage,
  });
  if (!resolved || recipientIsPage) {
    throw Object.assign(new Error("Messenger recipient resolved to the Page ID, not a customer PSID. Refusing to send."), {
      status: 409,
      code: "META_RECIPIENT_IS_PAGE_ID",
      recipient_id: resolved,
      page_id: [...pageIds][0] || "",
    });
  }
  return resolved;
};

export const sendMetaInboxOutboundMessage = async ({
  tenantId,
  channel = "",
  recipientId = "",
  messageText = "",
  conversationId = "",
  attachments = [],
  productCards = [],
  productCardLimit = 6,
  suggestedActions = [],
  facebookPageId = "",
  instagramBusinessAccountId = "",
  preferredConfigId = null,
} = {}) => {
  await ensureMetaIntegrationSchema();
  const scopedTenantId = numberOrNull(tenantId);
  const normalizedChannel = adapterChannel(channelAlias(channel) === "instagram" || channel === AI_AGENT_CHANNELS.INSTAGRAM ? "instagram" : "facebook");
  const safeRecipientId = text(recipientId);
  const safeMessage = text(messageText);
  const cards = await resolveProductCardLinks(normalizeProductCards(productCards, { limit: productCardLimit }), { tenantId: scopedTenantId });
  if (!scopedTenantId || !safeRecipientId || (!safeMessage && !cards.length)) {
    throw Object.assign(new Error("tenant_id, recipient id, and message are required"), { status: 400, code: "META_SEND_INPUT_REQUIRED" });
  }
  const { config, token, source } = await resolveMetaSendConfig({
    tenantId: scopedTenantId,
    channel: normalizedChannel,
    facebookPageId,
    instagramBusinessAccountId,
    preferredConfigId,
  });
  if (normalizedChannel === AI_AGENT_CHANNELS.FACEBOOK_MESSENGER) {
    safeRecipientId = resolveMessengerRecipientPsid({
      recipientId: safeRecipientId,
      conversationId,
      config,
      facebookPageId,
    });
  }
  const sendContext = {
    resolved_recipient_psid: safeRecipientId,
    resolved_page_id: text(facebookPageId || config.facebook_page_id || config.page_id),
    resolved_customer_id: safeRecipientId,
    resolved_sender_id: safeRecipientId,
  };
  console.log("ai_inbox_send_start", {
    tenant_id: scopedTenantId,
    config_id: config.id || null,
    config_source: source,
    channel: normalizedChannel,
    conversation_id: conversationId || "",
    recipient_id: maskIdForLog(safeRecipientId),
    resolved_recipient_psid: maskIdForLog(sendContext.resolved_recipient_psid),
    resolved_page_id: maskIdForLog(sendContext.resolved_page_id),
    resolved_customer_id: maskIdForLog(sendContext.resolved_customer_id),
    resolved_sender_id: maskIdForLog(sendContext.resolved_sender_id),
    payload_metadata: {
      message_length: safeMessage.length,
      product_card_count: cards.length,
      attachment_count: imageAttachmentUrls(attachments).length,
    },
  });
  let meta = null;
  const imageResults = [];
  const productCardMessages = [];
  if (cards.length) {
    for (const product of cards) {
      console.log("ai_inbox_selected_product_card", {
        tenant_id: scopedTenantId,
        config_id: config.id || null,
        channel: normalizedChannel,
        conversation_id: conversationId || "",
        selected_product_id: product.product_id || product.id || null,
        image_url_exists: Boolean(product.image_url),
        product_link_generated: product.product_url || product.url || "",
      });
      let imageMessageId = "";
      if (product.image_url) {
        try {
          const imageResult = await postMetaImageMessage({ token, recipientId: safeRecipientId, imageUrl: product.image_url, sendContext });
          imageResults.push(imageResult);
          imageMessageId = imageResult?.message_id || "";
          console.log("ai_inbox_messenger_send_image_success", {
            tenant_id: scopedTenantId,
            config_id: config.id || null,
            channel: normalizedChannel,
            conversation_id: conversationId || "",
            selected_product_id: product.product_id || product.id || null,
            image_url: product.image_url,
          });
        } catch (error) {
          console.warn("ai_inbox_messenger_send_image_failure", {
            tenant_id: scopedTenantId,
            config_id: config.id || null,
            channel: normalizedChannel,
            conversation_id: conversationId || "",
            selected_product_id: product.product_id || product.id || null,
            image_url: product.image_url,
            status: error?.status || "",
            message: error?.message || "Meta image send failed",
          });
        }
      }
      meta = await postMetaMessage({ token, recipientId: safeRecipientId, messageText: productCardReplyText(product), sendContext });
      productCardMessages.push({
        message_id: meta?.message_id || "",
        meta_mid: meta?.message_id || "",
        image_message_id: imageMessageId,
        image_mid: imageMessageId,
        product_id: product.product_id || product.id || null,
        variant_id: product.variant_id || null,
        color: product.color || "",
        sizes: product.sizes || product.available_sizes || [],
        price: product.price || null,
        image_url: product.image_url || "",
        product_url: product.product_url || product.url || "",
      });
    }
    if ((Array.isArray(suggestedActions) ? suggestedActions : []).length) {
      meta = await postMetaMessage({ token, recipientId: safeRecipientId, messageText: META_COMMERCE_ACTION_FALLBACK, sendContext });
      console.log("ai_inbox_suggested_action_generated", {
        tenant_id: scopedTenantId,
        config_id: config.id || null,
        channel: normalizedChannel,
        conversation_id: conversationId || "",
        actions: suggestedActions,
        fallback: true,
      });
    }
    console.log("ai_inbox_send_success", {
      tenant_id: scopedTenantId,
      config_id: config.id || null,
      channel: normalizedChannel,
      conversation_id: conversationId || "",
      recipient_id: maskIdForLog(safeRecipientId),
      message_id: meta?.message_id || "",
    });
    return {
      sent: true,
      channel: normalizedChannel,
      config_id: config.id || null,
      config_source: source,
      recipient_id: safeRecipientId,
      message_id: meta?.message_id || "",
      meta,
      product_card_messages: productCardMessages,
      results: [...imageResults, meta].filter(Boolean),
    };
  }
  try {
    for (const imageUrl of imageAttachmentUrls(attachments)) {
      try {
        const imageResult = await postMetaImageMessage({ token, recipientId: safeRecipientId, imageUrl, sendContext });
        imageResults.push(imageResult);
        console.log("ai_inbox_messenger_send_image_success", {
          tenant_id: scopedTenantId,
          config_id: config.id || null,
          channel: normalizedChannel,
          conversation_id: conversationId || "",
          image_url: imageUrl,
        });
      } catch (error) {
        console.warn("ai_inbox_messenger_send_image_failure", {
          tenant_id: scopedTenantId,
          config_id: config.id || null,
          channel: normalizedChannel,
          conversation_id: conversationId || "",
          recipient_id: maskIdForLog(safeRecipientId),
          image_url: imageUrl,
          status: error?.status || "",
          message: error?.message || "Meta image send failed",
        });
      }
    }
    meta = await postMetaMessage({ token, recipientId: safeRecipientId, messageText: safeMessage, sendContext });
  } catch (error) {
    console.error("ai_inbox_send_failed", {
      tenant_id: scopedTenantId,
      config_id: config.id || null,
      channel: normalizedChannel,
      conversation_id: conversationId || "",
      recipient_id: maskIdForLog(safeRecipientId),
      status: error?.status || "",
      code: error?.code || "",
      message: error?.message || "Meta Send API failed",
    });
    throw error;
  }
  console.log("ai_inbox_send_success", {
    tenant_id: scopedTenantId,
    config_id: config.id || null,
    channel: normalizedChannel,
    conversation_id: conversationId || "",
    recipient_id: maskIdForLog(safeRecipientId),
    message_id: meta?.message_id || "",
  });
  return {
    sent: true,
    channel: normalizedChannel,
    config_id: config.id || null,
    config_source: source,
    recipient_id: safeRecipientId,
    message_id: meta?.message_id || "",
    meta,
    results: [meta, ...imageResults],
  };
};

export const processMetaWebhook = async ({ req } = {}) => {
  const { pageIds, instagramBusinessAccountIds } = webhookAccountIdsFromBody(req.body);
  console.log("[meta-webhook] account ids extracted", {
    incoming_facebook_page_ids: pageIds.map(maskIdForLog),
    incoming_instagram_business_account_ids: instagramBusinessAccountIds.map(maskIdForLog),
    object: req.body?.object || "",
  });
  let config = null;
  const pairs = [];
  pageIds.forEach((pageId) => pairs.push({ pageId, instagramBusinessAccountId: "" }));
  instagramBusinessAccountIds.forEach((instagramBusinessAccountId) => pairs.push({ pageId: "", instagramBusinessAccountId }));
  pageIds.forEach((pageId) => {
    instagramBusinessAccountIds.forEach((instagramBusinessAccountId) => pairs.push({ pageId, instagramBusinessAccountId }));
  });
  for (const pair of pairs) {
    config = await findMetaConfigForAccount(pair);
    if (config) {
      console.log("[meta-webhook] config matched", {
        incoming_facebook_page_id: maskIdForLog(pair.pageId),
        incoming_instagram_business_account_id: maskIdForLog(pair.instagramBusinessAccountId),
        matched_config_id: config.id || null,
        matched_tenant_id: config.tenant_id || null,
        webhook_enabled: config.webhook_enabled === true,
      });
      break;
    }
  }
  if (!config) {
    if (!pairs.length) {
      await logMetaWebhookNoConfig({ strictRows: 0, fallbackRows: 0 });
    }
    return {
      ignored: "webhook_no_config",
      processed: 0,
      results: [],
      incoming_facebook_page_ids: pageIds.map(maskIdForLog),
      incoming_instagram_business_account_ids: instagramBusinessAccountIds.map(maskIdForLog),
    };
  }
  const appSecret = decryptSecret(config.app_secret_encrypted);
  const signatureOk = verifyMetaWebhookSignature({ rawBody: req.rawBody, signature: req.headers?.["x-hub-signature-256"], appSecret });
  if (!signatureOk) throw Object.assign(new Error("Invalid Meta webhook signature"), { status: 403 });
  const messages = extractMetaWebhookMessages({ body: req.body, tenantId: config.tenant_id }).filter((message) => message.message_text || message.attachments?.length);
  const results = [];
  for (const message of messages) {
    const alias = channelAlias(message.channel);
    const messageId = text(message.external_message_id || message.dedupe_key || "");
    if (isDuplicateMessage(messageId)) {
      pushAIEvent({
        type: "DUPLICATE_MESSAGE_SKIPPED",
        status: "warning",
        conversationId: message.external_conversation_id,
        platform: message.channel,
        messageId,
      });
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: false, duplicate: true, sent: false, reason: "duplicate_message" });
      continue;
    }
    const enabled = alias === "instagram" ? config.instagram_enabled === true : config.messenger_enabled === true;
    const inboxResult = await logIncomingToInbox({ message, config });
    await logChannelEvent({
      tenantId: config.tenant_id,
      channel: message.channel,
      direction: "inbound",
        externalCustomerId: message.external_customer_id,
        conversationId: message.external_conversation_id,
        messagePreview: message.message_text || "[attachment]",
        status: "received",
        metadata: {
          channel: alias,
          page_id: pageIds[0] || "",
          instagram_business_account_id: instagramBusinessAccountIds[0] || "",
          external_message_id: message.external_message_id || "",
          sender_psid: message.raw?.sender_psid || message.external_customer_id || "",
          customer_psid: message.raw?.customer_psid || message.external_customer_id || "",
          resolved_sender_id: message.raw?.sender_psid || message.external_customer_id || "",
          resolved_customer_id: message.external_customer_id || "",
          resolved_page_id: message.raw?.page_id || pageIds[0] || "",
          dedupe_key: message.dedupe_key || inboxResult?.dedupe_key || "",
        },
      }).catch(() => {});
    await upsertChannelConversationMapping({
      tenantId: config.tenant_id,
      channel: message.channel,
      externalConversationId: message.external_conversation_id,
      externalCustomerId: message.external_customer_id,
      customerName: message.customer_name,
      metadata: {
        page_id: config.facebook_page_id || pageIds[0] || "",
        instagram_business_account_id: config.instagram_business_account_id || "",
        account_id: pageIds[0] || instagramBusinessAccountIds[0] || "",
        channel: alias,
        sender_psid: message.raw?.sender_psid || message.external_customer_id || "",
        customer_psid: message.raw?.customer_psid || message.external_customer_id || "",
        resolved_sender_id: message.raw?.sender_psid || message.external_customer_id || "",
        resolved_customer_id: message.external_customer_id || "",
      },
      lastMessageAt: message.timestamp,
    }).catch(() => {});
    if (inboxResult?.duplicate) {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, duplicate: true, sent: false, reason: "duplicate_message" });
      continue;
    }
    if (!enabled) {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, reason: "channel_disabled" });
      continue;
    }
    const settings = await getChannelSettings({ tenantId: config.tenant_id, channel: message.channel }).catch(() => ({}));
    const autoReplyMode = text(settings.auto_reply_mode || (settings.ai_replies_enabled === true ? "fully_automatic" : "off")).toLowerCase();
    console.log("[meta-inbox] auto_reply_settings_resolved", {
      tenant_id: config.tenant_id,
      config_id: config.id || null,
      session_id: message.external_conversation_id,
      channel: alias,
      ai_replies_enabled: settings.ai_replies_enabled === true,
      auto_reply_mode: autoReplyMode,
      messenger_enabled: config.messenger_enabled === true,
      instagram_enabled: config.instagram_enabled === true,
    });
    if (settings.ai_replies_enabled !== true || autoReplyMode === "off") {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, reason: "auto_reply_disabled" });
      continue;
    }
    const conversationState = await getAiSupportConversationState({
      tenantId: config.tenant_id,
      sessionId: message.external_conversation_id,
    }).catch((error) => {
      console.warn("[meta-inbox] auto_reply_state_lookup_failed", {
        tenant_id: config.tenant_id,
        session_id: message.external_conversation_id,
        channel: alias,
        message: error?.message || "state lookup failed",
      });
      return null;
    });
    const status = text(conversationState?.status || "ai_active").toLowerCase();
    console.log("[meta-inbox] auto_reply_state_checks", {
      tenant_id: config.tenant_id,
      session_id: message.external_conversation_id,
      channel: alias,
      status,
      human_takeover: status === "human_takeover",
      ai_paused: ["human_takeover", "closed"].includes(status),
      closed: status === "closed",
    });
    if (["human_takeover", "closed"].includes(status)) {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, reason: status });
      continue;
    }
    console.log("[meta-inbox] meta_inbox_auto_reply_triggered", {
      tenant_id: config.tenant_id,
      session_id: message.external_conversation_id,
      channel: alias,
      external_customer_id: message.external_customer_id,
    });
    await recordLeadSignals({ config, message, reason: "inbound_message" }).catch(() => {});
    if (!["suggest_only", "auto_reply_after_approval"].includes(autoReplyMode)) {
      try {
        const preAiHandlers = [
          handleContextualSizeCheckIfMatched,
          handleCheckoutContinuationIfMatched,
          handleHumanHandoffIfMatched,
          answerFaqIfMatched,
          handleOtherColorsIfMatched,
          handleMoreImagesIfMatched,
          handleAlternativesIfMatched,
          handleSizesIfMatched,
          handleOrderDraftIfMatched,
          handleSizeAvailabilityLinkIfMatched,
          handleVisualSearchIfMatched,
        ];
        let handled = null;
        for (const handler of preAiHandlers) {
          handled = await handler({ config, message });
          if (handled?.handled) break;
        }
        if (handled?.handled) {
          results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: true, reason: handled.reason });
          continue;
        }
      } catch (error) {
        console.error("ai_inbox_commerce_handler_failed", {
          tenant_id: config.tenant_id,
          conversation_id: message.external_conversation_id,
          channel: alias,
          message: error?.message || "commerce handler failed",
          code: error?.code || "",
        });
      }
    }
    let aiPayload;
    try {
      aiPayload = await routeMessageThroughAi({ req, message, config });
      console.log("[meta-inbox] auto_reply_ai_generation_result", {
        tenant_id: config.tenant_id,
        session_id: message.external_conversation_id,
        channel: alias,
        has_answer: Boolean(text(aiPayload?.answer)),
        has_channel_reply: Boolean(aiPayload?.channel_reply),
        channel_reply_text_length: text(aiPayload?.channel_reply?.text).length,
        suggested_product_count: Array.isArray(aiPayload?.suggested_products) ? aiPayload.suggested_products.length : 0,
        conversation_status: text(aiPayload?.conversation_status || ""),
        detected_intent: text(aiPayload?.detected_intent || ""),
      });
      await linkChannelConversationToCustomerProfile({
        tenantId: config.tenant_id,
        channel: message.channel,
        externalConversationId: message.external_conversation_id,
        externalCustomerId: message.external_customer_id,
      }).catch(() => {});
    } catch (error) {
      console.error("[meta-inbox] auto_reply_ai_generation_failed", {
        tenant_id: config.tenant_id,
        session_id: message.external_conversation_id,
        channel: alias,
        message: error?.message || "AI flow failed",
        status: error?.status || "",
        code: error?.code || "",
      });
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, ai_error: error?.message || "AI flow failed" });
      continue;
    }
    if (["suggest_only", "auto_reply_after_approval"].includes(autoReplyMode)) {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, reason: autoReplyMode });
      continue;
    }
    const reply = aiPayload.channel_reply || normalizeOutgoingChannelReply({ channel: message.channel, response: aiPayload });
    const modelNameSearch = detectModelNameSearch(message.message_text || "") && !detectAllColorsRequest(message.message_text || "");
    const productCardLimit = modelNameSearch ? (detectOtherColorsRequest(message.message_text || "") ? 3 : 2) : 6;
    let productCards = normalizeProductCards(reply.product_cards || aiPayload.suggested_products || [], { limit: productCardLimit });
    if (modelNameSearch && productCards.length > productCardLimit) productCards = productCards.slice(0, productCardLimit);
    if (modelNameSearch) {
      console.log("ai_model_color_limit_applied", {
        tenant_id: config.tenant_id,
        conversation_id: message.external_conversation_id,
        requested_limit: productCardLimit,
        resulting_card_count: productCards.length,
        all_colors_requested: detectAllColorsRequest(message.message_text || ""),
        other_colors_requested: detectOtherColorsRequest(message.message_text || ""),
      });
    }
    productCards = await resolveProductCardLinks(productCards, { tenantId: config.tenant_id });
    const replyText = modelNameSearch && productCards.length >= 2
      ? [modelColorLimitIntro, reply.text || aiPayload.answer || ""].filter(Boolean).join("\n")
      : reply.text || aiPayload.answer || "";
    if (productCards.length && repeatedProductCards({ conversationId: message.external_conversation_id, productCards }) && !explicitlyAskedForProductCards(message.message_text)) {
      console.log("ai_inbox_repeated_product_card_prevented", {
        tenant_id: config.tenant_id,
        channel: message.channel,
        conversation_id: message.external_conversation_id,
        product_ids: productCards.map((product) => product.product_id || product.id || null).filter(Boolean),
      });
      const memory = getConversationMemory(message.external_conversation_id) || {};
      const selectedSize = text(memory.selectedSize);
      const prompt = checkoutStageAtLeast(memory.checkoutStage, "checkout")
        ? CHECKOUT_INFO_REPLY
        : memory.bookingConfirmationAsked === true && selectedSize
          ? repeatedBookingConfirmationPrompt()
          : selectedSize
            ? bookingConfirmationPrompt(selectedSize)
            : null;
      const legacyPrompt = selectedSize
        ? `مقاس ${selectedSize} متاح. ${CHECKOUT_INFO_REPLY}`
        : "موجود معايا. تحب أحجزهولك؟ ابعت المقاس المناسب.";
      await sendAndLogMetaText({
        config,
        message,
        text: prompt || legacyPrompt,
        detectedIntent: "repeated_product_card_prevented",
        metadata: { repeated_product_card_prevented: true, checkout_stage: memory.checkoutStage || "" },
      });
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: true, reason: "repeated_product_card_prevented" });
      continue;
    }
    const aiStatus = text(aiPayload.conversation_status || aiPayload.detected_intent).toLowerCase();
    console.log("[meta-inbox] auto_reply_post_ai_checks", {
      tenant_id: config.tenant_id,
      session_id: message.external_conversation_id,
      channel: alias,
      reply_text_length: text(replyText).length,
      product_card_count: productCards.length,
      ai_status: aiStatus,
      human_takeover: aiStatus === "human_takeover",
      ai_paused: ["human_takeover", "closed"].includes(aiStatus),
      closed: aiStatus === "closed",
    });
    if ((!replyText && !productCards.length) || ["human_takeover", "closed"].includes(aiStatus)) {
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, reason: "ai_paused" });
      continue;
    }
    try {
      const outboundPreview = productCards.length ? productCards.map(productCardReplyText).join("\n\n").slice(0, 500) : replyText;
      if (productCards.length && modelNameSearch && replyText) {
        await sendAndLogMetaText({
          config,
          message,
          text: replyText,
          detectedIntent: "model_color_limit_intro",
          metadata: { model_color_limit_applied: true, product_card_count: productCards.length },
        });
      }
      const sendResult = await sendMetaInboxOutboundMessage({
        tenantId: config.tenant_id,
        channel: message.channel,
        recipientId: message.external_customer_id,
        messageText: replyText,
        conversationId: message.external_conversation_id,
        productCards,
        productCardLimit: productCards.length || productCardLimit,
        suggestedActions: productCards.length ? META_COMMERCE_ACTIONS : [],
        facebookPageId: config.facebook_page_id || pageIds[0] || "",
        instagramBusinessAccountId: config.instagram_business_account_id || instagramBusinessAccountIds[0] || "",
        preferredConfigId: config.id,
      });
      if (productCards.length) {
        rememberLastProductCards({ conversationId: message.external_conversation_id, productCards, sentMessages: sendResult?.product_card_messages || [] });
        await recordLeadSignals({ config, message, reason: "product_cards_sent" }).catch(() => {});
        console.log("ai_inbox_suggested_action_generated", {
          tenant_id: config.tenant_id,
          channel: message.channel,
          conversation_id: message.external_conversation_id,
          actions: META_COMMERCE_ACTIONS,
          fallback: true,
        });
      }
      const inserted = await appendAiGeneratedSupportReply({
        tenantId: config.tenant_id,
        sessionId: message.external_conversation_id,
        answer: outboundPreview,
        detectedIntent: aiPayload.detected_intent || "",
        suggestedProducts: productCards,
        suggestedActions: productCards.length ? META_COMMERCE_ACTIONS : [],
        channel: message.channel,
        deliveryStatus: "sent",
        externalMessageId: sendResult?.message_id || "",
      }).catch((error) => {
        console.error("[meta-inbox] ai_outbound_db_insert_failed", {
          tenant_id: config.tenant_id,
          session_id: message.external_conversation_id,
          channel: message.channel,
          message: error?.message || "AI outbound insert failed",
          code: error?.code || "",
        });
        return null;
      });
      console.log("[meta-inbox] ai_outbound_db_insert_result", {
        tenant_id: config.tenant_id,
        session_id: message.external_conversation_id,
        channel: message.channel,
        message_id: inserted?.id || null,
        delivery_status: inserted?.delivery_status || "",
        external_message_id: inserted?.external_message_id || sendResult?.message_id || "",
      });
      await logChannelEvent({
        tenantId: config.tenant_id,
        channel: message.channel,
        direction: "outbound",
        externalCustomerId: message.external_customer_id,
        conversationId: message.external_conversation_id,
        messagePreview: outboundPreview,
        status: "sent",
        metadata: {
          meta_message_id: sendResult?.message_id || "",
          image_result_count: Array.isArray(sendResult?.results) ? Math.max(0, sendResult.results.length - 1) : 0,
          product_card_count: productCards.length,
          suggested_actions: productCards.length ? META_COMMERCE_ACTIONS : [],
        },
      }).catch(() => {});
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: true });
    } catch (error) {
      console.error("[meta-inbox] auto_reply_send_failed", {
        tenant_id: config.tenant_id,
        config_id: config.id || null,
        session_id: message.external_conversation_id,
        channel: alias,
        recipient_id: maskIdForLog(message.external_customer_id),
        status: error?.status || "",
        code: error?.code || "",
        message: error?.message || "Meta send failed",
        meta_error: error?.metaResponse?.error || null,
      });
      results.push({ channel: alias, external_user_id: message.external_customer_id, stored: true, sent: false, send_error: error?.message || "Meta send failed" });
    }
  }
  await db.query(`UPDATE meta_integration_configs SET last_sync_at = NOW(), updated_at = NOW() WHERE tenant_id = $1`, [config.tenant_id]).catch(() => {});
  return { processed: results.length, results };
};

export const getPublicWebhookVerificationConfig = async ({ verifyToken } = {}) => {
  const config = await findMetaConfigForWebhookVerification({ verifyToken });
  if (config) return config;
  const expected = text(process.env.META_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  return expected && expected === text(verifyToken) ? { verify_token: expected } : null;
};

export { adapterChannel };
