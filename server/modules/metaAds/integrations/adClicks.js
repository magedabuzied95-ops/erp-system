// Click-to-message attribution ("نقرات الإعلان").
//
// A chat that starts from an ad carries the ad's context:
//   Messenger / Instagram  event.referral | message.referral | postback.referral
//                          { source:"ADS", type:"OPEN_THREAD", ad_id, ref, ads_context_data{ad_title, photo_url, video_url, post_id, product_id} }
//   WhatsApp Cloud API     message.referral
//                          { source_url, source_id, source_type ("ad"|"post"), body, headline, media_type, image_url, video_url, thumbnail_url, ctwa_clid }
//   Evolution / Baileys    message.*.contextInfo.externalAdReply
//                          { title, body, mediaType, thumbnailUrl, mediaUrl, sourceUrl, sourceId, sourceType, ctwaClid }
//
// The inbound paths call these fire-and-forget; nothing here may throw into them.

import db from "../../../database/db.js";
import { canonicalPhoneKey } from "../../../utils/phoneSearch.js";
import { normalizeWhatsappSessionId } from "../../../utils/whatsappIdentity.js";
import { clip, findCustomerByPhone, isReady, log, lower, text, warn } from "./integrationsCommon.js";

const CHANNELS = new Set(["whatsapp", "messenger", "instagram"]);

const channelOf = (value) => {
  const raw = lower(value);
  if (raw.includes("insta")) return "instagram";
  if (raw.includes("whats")) return "whatsapp";
  if (raw.includes("messenger") || raw.includes("facebook")) return "messenger";
  return CHANNELS.has(raw) ? raw : "";
};

const mediaTypeOf = (value) => {
  const raw = lower(value);
  if (raw === "1" || raw.includes("image") || raw.includes("photo")) return "image";
  if (raw === "2" || raw.includes("video")) return "video";
  return raw || null;
};

export const normalizeReferral = (channel, referral = {}) => {
  const ref = referral && typeof referral === "object" ? referral : {};
  if (channel === "whatsapp") {
    // Cloud API shape and Baileys externalAdReply shape, whichever is present.
    const sourceId = text(ref.source_id || ref.sourceId || ref.sourceID);
    const ctwaClid = text(ref.ctwa_clid || ref.ctwaClid || ref.ctwaclid);
    const sourceUrl = text(ref.source_url || ref.sourceUrl);
    if (!sourceId && !ctwaClid && !sourceUrl) return null;
    return {
      source_type: lower(ref.source_type || ref.sourceType) || (sourceId ? "ad" : null),
      source_id: sourceId || null,
      source_url: sourceUrl || null,
      ad_headline: clip(ref.headline || ref.title, 500) || null,
      ad_body: clip(ref.body, 2000) || null,
      media_type: mediaTypeOf(ref.media_type || ref.mediaType),
      media_url: text(ref.image_url || ref.video_url || ref.mediaUrl || ref.thumbnail_url || ref.thumbnailUrl || ref.originalImageUrl) || null,
      post_id: null,
      ctwa_clid: ctwaClid || null,
      custom_ref: text(ref.ref) || null,
    };
  }
  const context = ref.ads_context_data || {};
  const adId = text(ref.ad_id);
  const source = lower(ref.source);
  // Plain m.me / ig.me links (source SHORTLINK, CUSTOMER_CHAT_PLUGIN …) are not ads.
  if (!adId && source !== "ads") return null;
  return {
    source_type: "ad",
    source_id: adId || null,
    source_url: null,
    ad_headline: clip(context.ad_title, 500) || null,
    ad_body: null,
    media_type: context.video_url ? "video" : context.photo_url ? "image" : null,
    media_url: text(context.photo_url || context.video_url) || null,
    post_id: text(context.post_id) || null,
    ctwa_clid: null,
    custom_ref: text(ref.ref || context.product_id) || null,
  };
};

const resolveAd = async (tenantId, sourceId) => {
  if (!sourceId) return null;
  const { rows } = await db.query(
    `SELECT a.id AS ad_id, a.account_id, a.adset_id, s.campaign_id
       FROM meta_ads_ads a LEFT JOIN meta_ads_adsets s ON s.id = a.adset_id
      WHERE a.tenant_id = $1 AND a.meta_id = $2 LIMIT 1`,
    [tenantId, sourceId],
  );
  return rows[0] || null;
};

// The CRM customer behind a conversation: WhatsApp by its phone; Messenger /
// Instagram through the inbox's conversation → AI customer profile → phone.
const customerForConversation = async (tenantId, channel, conversationKey, handle) => {
  try {
    if (channel === "whatsapp") {
      const customer = await findCustomerByPhone(tenantId, handle || conversationKey.replace(/^whatsapp:/, ""));
      return customer?.id || null;
    }
    const { rows } = await db.query(
      `SELECT p.phone FROM ai_channel_conversations c JOIN ai_customer_profiles p ON p.id = c.customer_profile_id AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND (c.external_conversation_id = $2 OR c.external_customer_id = $3) AND COALESCE(p.phone,'') <> ''
        ORDER BY c.updated_at DESC LIMIT 1`,
      [tenantId, conversationKey, text(handle)],
    );
    if (!rows[0]?.phone) return null;
    const customer = await findCustomerByPhone(tenantId, rows[0].phone);
    return customer?.id || null;
  } catch {
    return null;
  }
};

/**
 * recordAdReferral({ tenantId, channel, conversationKey, senderId, contactName, referral, raw })
 * → the inserted click row id, or null when the referral is not an ad / is a duplicate.
 */
export const recordAdReferral = async ({ tenantId, channel, conversationKey = "", senderId = "", contactName = "", referral = null, raw = null } = {}) => {
  if (!isReady() || !Number(tenantId) || !referral) return null;
  const normalizedChannel = channelOf(channel);
  if (!normalizedChannel) return null;
  const info = normalizeReferral(normalizedChannel, referral);
  if (!info) return null;
  const key = normalizedChannel === "whatsapp"
    ? (text(conversationKey).startsWith("whatsapp:") ? text(conversationKey) : normalizeWhatsappSessionId(conversationKey || senderId, senderId) || text(conversationKey))
    : text(conversationKey) || `${normalizedChannel}:${text(senderId)}`;
  const handle = normalizedChannel === "whatsapp" ? (canonicalPhoneKey(senderId) ? text(senderId).replace(/\D/g, "") : text(senderId)) : text(senderId);

  // The same click reaches us twice on a Coexistence number (Cloud + Evolution) and
  // Messenger can send the referral both alone and with the first message.
  const { rows: dupes } = await db.query(
    `SELECT id FROM meta_ads_ad_clicks
      WHERE tenant_id = $1 AND (
        ($2::text <> '' AND ctwa_clid = $2::text)
        OR (conversation_key = $3 AND COALESCE(source_id,'') = $4 AND clicked_at > NOW() - INTERVAL '30 minutes')
      ) LIMIT 1`,
    [tenantId, text(info.ctwa_clid), key, text(info.source_id)],
  );
  if (dupes[0]) return null;

  const ad = await resolveAd(tenantId, info.source_type === "post" ? "" : info.source_id).catch(() => null);
  const { rows: earlier } = await db.query(`SELECT 1 FROM meta_ads_ad_clicks WHERE tenant_id = $1 AND conversation_key = $2 LIMIT 1`, [tenantId, key]);
  const customerId = await customerForConversation(tenantId, normalizedChannel, key, handle);
  const { rows } = await db.query(
    `INSERT INTO meta_ads_ad_clicks (tenant_id, clicked_at, channel, conversation_key, customer_id, contact_name, contact_handle, ad_headline, ad_body,
       source_type, source_id, source_url, media_type, media_url, post_id, ctwa_clid, custom_ref, account_id, campaign_id, adset_id, ad_id,
       attribution_status, first_touch, raw)
     VALUES ($1,NOW(),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb) RETURNING id`,
    [
      tenantId, normalizedChannel, key, customerId, clip(contactName, 255) || null, handle || null, info.ad_headline, info.ad_body,
      info.source_type, info.source_id, info.source_url, info.media_type, info.media_url, info.post_id, info.ctwa_clid, info.custom_ref,
      ad?.account_id || null, ad?.campaign_id || null, ad?.adset_id || null, ad?.ad_id || null,
      ad ? "resolved" : "unknown_ad", !earlier[0], JSON.stringify(raw ?? referral),
    ],
  );
  log("ad-click", { tenant_id: tenantId, channel: normalizedChannel, resolved: Boolean(ad), first_touch: !earlier[0] });
  // The conversation's "تتبع الحملة" record (first/last touch, click counters) for the inbox card
  // and the order copy. Detached and safe, like this whole path.
  if (rows[0]?.id) {
    void import("../../campaignAttribution/attribution.js")
      .then((m) => m.recordAdClickTouchSafe({ tenantId, clickId: rows[0].id }))
      .catch(() => {});
    // A chat from an ad is a lead from its first message (Genie: CTWA → "جديد").
    void import("../../crmStages/autoStage.js")
      .then((m) => m.advanceConversationLeadStageLater({ tenantId, sessionId: key, stage: "new", source: "ad_click", retryAfterMs: [5000, 30000] }))
      .catch(() => {});
  }
  return rows[0]?.id || null;
};

// Evolution / Baileys: the ad context sits in some message type's contextInfo.
const findExternalAdReply = (node, depth = 0) => {
  if (!node || typeof node !== "object" || depth > 7) return null;
  if (node.externalAdReply && typeof node.externalAdReply === "object") return node.externalAdReply;
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") {
      const hit = findExternalAdReply(value, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
};

export const recordEvolutionAdReferral = async ({ tenantId, payload, remoteJid = "", phone = "", contactName = "" } = {}) => {
  const adReply = findExternalAdReply(payload?.data?.message || payload?.data || payload);
  if (!adReply) return null;
  const sourceId = text(adReply.sourceId || adReply.sourceID);
  const ctwaClid = text(adReply.ctwaClid);
  // A link preview also uses externalAdReply; only an ad/post click carries these.
  if (!sourceId && !ctwaClid && !/^(ad|post)$/i.test(text(adReply.sourceType))) return null;
  const conversationKey = normalizeWhatsappSessionId(remoteJid || phone, phone);
  return recordAdReferral({
    tenantId,
    channel: "whatsapp",
    conversationKey,
    senderId: phone || conversationKey.replace(/^whatsapp:/, ""),
    contactName,
    referral: adReply,
    raw: { externalAdReply: adReply },
  });
};

// Safe entry for hooks: never rejects.
export const recordAdReferralSafe = (input) => recordAdReferral(input).catch((error) => {
  warn("ad-click", error, { tenant_id: input?.tenantId });
  return null;
});
export const recordEvolutionAdReferralSafe = (input) => recordEvolutionAdReferral(input).catch((error) => {
  warn("ad-click-evolution", error, { tenant_id: input?.tenantId });
  return null;
});

/**
 * Latest ad click of a conversation + the active "AI Instructions" of its ad /
 * ad set / campaign + the chat team the ad routes to. null when the chat did not
 * come from an ad.
 */
export const getAdContextForConversation = async (tenantId, conversationKey) => {
  if (!isReady() || !Number(tenantId) || !text(conversationKey)) return null;
  const { rows } = await db.query(
    `SELECT * FROM meta_ads_ad_clicks WHERE tenant_id = $1 AND conversation_key = $2 ORDER BY clicked_at DESC LIMIT 1`,
    [tenantId, text(conversationKey)],
  );
  const click = rows[0];
  if (!click) return null;
  const objects = [
    ["ad", click.ad_id, "meta_ads_ads"],
    ["adset", click.adset_id, "meta_ads_adsets"],
    ["campaign", click.campaign_id, "meta_ads_campaigns"],
  ].filter(([, id]) => id);
  const instructions = [];
  let chatTeamId = null;
  for (const [type, id, table] of objects) {
    const { rows: list } = await db.query(
      `SELECT message, expires_at FROM meta_ads_ai_instructions
        WHERE tenant_id = $1 AND object_type IN ($2::text, $2::text || 's', REPLACE($2::text, 'adset', 'ad_set')) AND object_id = $3
          AND COALESCE(message,'') <> '' AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY id`,
      [tenantId, type, id],
    );
    for (const item of list) instructions.push({ level: type, message: item.message, expires_at: item.expires_at });
    if (!chatTeamId) {
      const { rows: team } = await db.query(`SELECT chat_team_id FROM ${table} WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      chatTeamId = team[0]?.chat_team_id || null;
    }
  }
  return { click, instructions, chat_team_id: chatTeamId };
};
