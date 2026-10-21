// Conversation attribution ("تتبع الحملة"): which campaign an inbox conversation came from.
//
// GENI keeps this on a CRM lead (tab "Campaign Tracking" + section "Meta Attribution", a megaphone
// line on the kanban card). Our lead IS the inbox conversation, so the record is kept per
// conversation: one row per (tenant_id, session_id) with the FIRST touch and the LAST touch, each a
// small JSON "touch", plus the ad-click counters GENI shows (count, first click, last click).
//
// Where touches come from:
//   meta_ad            a click-to-message ad referral, recorded by metaAds/integrations/adClicks.js
//                      (→ recordAdClickTouchSafe below)
//   whatsapp_campaign  a template campaign: on send (auto lead generation — only opens the record,
//                      never overwrites another source) and on the customer's reply (a real touch)
//   tracking_link      reserved for storefront tracking links (utils/marketingAttribution.js)
//
// Every writer is called fire-and-forget from a hot path (webhook, campaign send loop); none of
// them may throw into it. Readers return null when there is nothing to show.

import db from "../../database/db.js";

const text = (value) => (value === undefined || value === null ? "" : String(value).trim());
const clip = (value, max = 500) => text(value).slice(0, max);
const idOrNull = (value) => (Number(value) > 0 ? Number(value) : null);
const asArray = (value) => (Array.isArray(value) ? value : []);

export const SOURCE_TYPES = Object.freeze(["meta_ad", "whatsapp_campaign", "tracking_link"]);
// A WhatsApp campaign's own AI instructions follow a reply to it for this long.
export const CAMPAIGN_AI_WINDOW_DAYS = 7;
// "Their first reply since the campaign": a reply counts for the campaign inside this window.
export const CAMPAIGN_REPLY_WINDOW_HOURS = 72;

/* ------------------------------------------------------------------ schema */

let schemaPromise = null;
export const ensureConversationAttributionSchema = () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS inbox_conversation_attribution (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          session_id TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT '',
          source_type TEXT NOT NULL DEFAULT '',
          campaign_name TEXT NOT NULL DEFAULT '',
          broadcast_id BIGINT NULL,
          meta_campaign_id BIGINT NULL,
          meta_adset_id BIGINT NULL,
          meta_ad_id BIGINT NULL,
          first_touch JSONB NOT NULL DEFAULT '{}'::jsonb,
          last_touch JSONB NOT NULL DEFAULT '{}'::jsonb,
          ad_clicks_count INTEGER NOT NULL DEFAULT 0,
          first_ad_click_at TIMESTAMPTZ NULL,
          last_ad_click_at TIMESTAMPTZ NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (tenant_id, session_id)
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conv_attr_broadcast ON inbox_conversation_attribution (tenant_id, broadcast_id) WHERE broadcast_id IS NOT NULL`);
      await db.query(`CREATE INDEX IF NOT EXISTS idx_inbox_conv_attr_meta_campaign ON inbox_conversation_attribution (tenant_id, meta_campaign_id) WHERE meta_campaign_id IS NOT NULL`);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};

/* ------------------------------------------------------------------ pure helpers (exported for tests) */

// GENI's UTM block for a lead that did not come through a link: derived from where it did come from.
export const utmForTouch = (touch = {}) => {
  const type = text(touch.source_type);
  if (type === "meta_ad") {
    return { utm_source: "meta", utm_medium: touch.channel === "whatsapp" ? "click_to_whatsapp" : "click_to_message", utm_campaign: text(touch.meta_campaign_name || touch.campaign_name) };
  }
  if (type === "whatsapp_campaign") return { utm_source: "whatsapp", utm_medium: "template_campaign", utm_campaign: text(touch.campaign_name) };
  return { utm_source: text(touch.utm_source), utm_medium: text(touch.utm_medium), utm_campaign: text(touch.utm_campaign || touch.campaign_name) };
};

/** One touch, cleaned to the fields the card and the order copy read. */
export const normalizeTouch = (input = {}) => {
  const sourceType = SOURCE_TYPES.includes(text(input.source_type)) ? text(input.source_type) : "";
  if (!sourceType) return null;
  const touch = {
    source_type: sourceType,
    channel: clip(input.channel, 40),
    campaign_name: clip(input.campaign_name || input.meta_campaign_name, 200),
    broadcast_id: idOrNull(input.broadcast_id),
    meta_campaign_id: idOrNull(input.meta_campaign_id),
    meta_campaign_name: clip(input.meta_campaign_name, 200),
    meta_adset_id: idOrNull(input.meta_adset_id),
    meta_adset_name: clip(input.meta_adset_name, 200),
    meta_ad_id: idOrNull(input.meta_ad_id),
    meta_ad_name: clip(input.meta_ad_name, 200),
    ad_headline: clip(input.ad_headline, 500),
    ad_body: clip(input.ad_body, 2000),
    ad_source_url: clip(input.ad_source_url, 1000),
    ctwa_clid: clip(input.ctwa_clid, 300),
    attribution_status: clip(input.attribution_status, 40),
    // "send" (auto lead generation) | "reply" | "quoted_reply" | "ad_click"
    via: clip(input.via, 40),
    at: input.at ? new Date(input.at).toISOString() : new Date().toISOString(),
  };
  return { ...touch, ...utmForTouch({ ...input, ...touch }) };
};

const clickView = (click = {}) => ({
  id: Number(click.id) || null,
  clicked_at: click.clicked_at || null,
  channel: text(click.channel),
  headline: text(click.ad_headline),
  campaign: text(click.campaign_name),
  adset: text(click.adset_name),
  ad: text(click.ad_name),
  attribution_status: text(click.attribution_status) || "unknown_ad",
  // "View ad": the ad's own link when Meta sent one, else the boosted post.
  view_url: text(click.source_url) || (text(click.post_id) ? `https://www.facebook.com/${text(click.post_id)}` : ""),
});

/**
 * What the inbox card draws: GENI's Campaign Tracking + Meta Attribution fields and the Ad Clicks
 * list. `row` is the stored attribution (may be null for a chat whose ad clicks predate it);
 * `clicks` are its meta_ads_ad_clicks rows, newest first, with campaign/adset/ad names joined.
 * null = nothing to show (the card hides).
 */
export const buildAttributionView = ({ row = null, clicks = [] } = {}) => {
  const clickList = asArray(clicks);
  const latestClick = clickList[0] || null;
  const lastTouch = row?.last_touch && Object.keys(row.last_touch).length
    ? row.last_touch
    : latestClick
      ? normalizeTouch({
        source_type: "meta_ad",
        channel: latestClick.channel,
        meta_campaign_id: latestClick.campaign_id,
        meta_campaign_name: latestClick.campaign_name,
        meta_adset_id: latestClick.adset_id,
        meta_adset_name: latestClick.adset_name,
        meta_ad_id: latestClick.ad_id,
        meta_ad_name: latestClick.ad_name,
        ad_headline: latestClick.ad_headline,
        ad_body: latestClick.ad_body,
        ad_source_url: latestClick.source_url,
        ctwa_clid: latestClick.ctwa_clid,
        attribution_status: latestClick.attribution_status,
        via: "ad_click",
        at: latestClick.clicked_at,
      })
      : null;
  if (!lastTouch) return null;
  const firstTouch = row?.first_touch && Object.keys(row.first_touch).length ? row.first_touch : lastTouch;
  // The Meta block reads the newest AD touch even when a later WhatsApp campaign is the last touch.
  const adTouch = lastTouch.source_type === "meta_ad" ? lastTouch : firstTouch.source_type === "meta_ad" ? firstTouch : null;
  const firstClick = clickList[clickList.length - 1] || null;
  const clicksCount = Math.max(Number(row?.ad_clicks_count) || 0, clickList.length);
  return {
    source_type: lastTouch.source_type,
    campaign_name: text(lastTouch.campaign_name || lastTouch.meta_campaign_name),
    channel: text(lastTouch.channel || row?.channel),
    first_touch: firstTouch,
    last_touch: lastTouch,
    tracking: {
      utm_source: text(lastTouch.utm_source),
      utm_medium: text(lastTouch.utm_medium),
      utm_campaign: text(lastTouch.utm_campaign),
      ad_headline: text(adTouch?.ad_headline),
      ad_body: text(adTouch?.ad_body),
      ad_source_url: text(adTouch?.ad_source_url),
    },
    meta: adTouch || clicksCount
      ? {
        campaign: text(adTouch?.meta_campaign_name || latestClick?.campaign_name),
        adset: text(adTouch?.meta_adset_name || latestClick?.adset_name),
        ad: text(adTouch?.meta_ad_name || latestClick?.ad_name),
        channel: text(adTouch?.channel || latestClick?.channel),
        attribution_status: text(adTouch?.attribution_status || latestClick?.attribution_status) || "unknown_ad",
        clicks_count: clicksCount,
        first_click_at: row?.first_ad_click_at || firstClick?.clicked_at || null,
        last_click_at: row?.last_ad_click_at || latestClick?.clicked_at || null,
        ctwa_clid: text(adTouch?.ctwa_clid || latestClick?.ctwa_clid),
      }
      : null,
    whatsapp_campaign: lastTouch.source_type === "whatsapp_campaign" || firstTouch.source_type === "whatsapp_campaign"
      ? (() => {
        const touch = lastTouch.source_type === "whatsapp_campaign" ? lastTouch : firstTouch;
        return { id: idOrNull(touch.broadcast_id), name: text(touch.campaign_name), via: text(touch.via), at: touch.at || null };
      })()
      : null,
    clicks: clickList.slice(0, 20).map(clickView),
  };
};

/**
 * The order's marketing fields (orders.marketing_source / _platform / _campaign / attribution_type
 * / _post_id / _session_id), the same columns tracking links fill, so the campaign revenue report
 * counts a sale that started in a chat. null when the chat has no campaign.
 */
export const orderAttributionFromView = (view = null, sessionId = "") => {
  if (!view?.last_touch) return null;
  const touch = view.last_touch;
  const channel = text(touch.channel || view.channel).toLowerCase();
  const platform = touch.source_type === "whatsapp_campaign" || channel.includes("whats")
    ? "whatsapp"
    : channel.includes("insta")
      ? "instagram"
      : "facebook";
  const campaign = text(touch.campaign_name || touch.meta_campaign_name);
  if (!campaign && touch.source_type !== "meta_ad") return null;
  return {
    marketing_source: touch.source_type === "meta_ad" ? "meta_ads" : touch.source_type,
    marketing_platform: platform,
    marketing_campaign: campaign || "Meta ad (unknown)",
    // orders.marketing_post_id is BIGINT: only a numeric Meta ad id fits. "broadcast:<id>" was
    // written there and failed every order from a campaign chat (22P02, 2026-10-21); the campaign
    // is still on the order by name in marketing_campaign.
    marketing_post_id: /^\d+$/.test(text(touch.meta_ad_id)) ? text(touch.meta_ad_id) : null,
    attribution_type: "conversation",
    marketing_session_id: text(sessionId) || null,
  };
};

/** The order with the conversation's fields filled in where the order has none. */
export const mergeOrderAttribution = (order = {}, fields = null) => {
  if (!fields) return order;
  const merged = { ...order };
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== null && value !== undefined && !text(merged[key])) merged[key] = value;
  });
  return merged;
};

/** The AI's extra instructions, as one block, or "" when there are none. */
export const formatCampaignInstructions = ({ meta = [], campaign = null } = {}) => {
  const lines = [];
  asArray(meta).forEach((item) => {
    const message = text(item?.message);
    if (message) lines.push(`- (${text(item.level) || "ad"}) ${message}`);
  });
  if (campaign && text(campaign.instructions)) lines.push(`- (whatsapp campaign «${text(campaign.name)}») ${text(campaign.instructions)}`);
  if (!lines.length) return "";
  return [
    "العميل ده جاي من حملة إعلانية. تعليمات صاحب المحل للحملة دي (اتبعها في ردك، من غير ما تقولها للعميل):",
    ...lines,
  ].join("\n");
};

/* ------------------------------------------------------------------ writers */

/**
 * Records one touch on a conversation. `mode`:
 *   "touch" (default) — the touch becomes the last touch; the first touch is kept
 *   "open"            — only creates the record when the conversation has none (a campaign SEND:
 *                       auto lead generation must not overwrite an ad the customer actually clicked)
 */
export const recordConversationTouch = async ({ tenantId, sessionId, touch: rawTouch, mode = "touch", adClick = false } = {}) => {
  const safeTenant = Number(tenantId) || 0;
  const safeSession = text(sessionId);
  const touch = normalizeTouch(rawTouch || {});
  if (!safeTenant || !safeSession || !touch) return null;
  await ensureConversationAttributionSchema();
  const clicks = adClick ? 1 : 0;
  const conflict = mode === "open"
    ? "DO NOTHING"
    : `DO UPDATE SET
        channel = COALESCE(NULLIF(EXCLUDED.channel, ''), a.channel),
        source_type = EXCLUDED.source_type,
        campaign_name = EXCLUDED.campaign_name,
        broadcast_id = EXCLUDED.broadcast_id,
        meta_campaign_id = EXCLUDED.meta_campaign_id,
        meta_adset_id = EXCLUDED.meta_adset_id,
        meta_ad_id = EXCLUDED.meta_ad_id,
        first_touch = CASE WHEN a.first_touch = '{}'::jsonb THEN EXCLUDED.first_touch ELSE a.first_touch END,
        last_touch = EXCLUDED.last_touch,
        ad_clicks_count = a.ad_clicks_count + EXCLUDED.ad_clicks_count,
        first_ad_click_at = COALESCE(a.first_ad_click_at, EXCLUDED.first_ad_click_at),
        last_ad_click_at = COALESCE(EXCLUDED.last_ad_click_at, a.last_ad_click_at),
        updated_at = NOW()`;
  const result = await db.query(
    `INSERT INTO inbox_conversation_attribution AS a
       (tenant_id, session_id, channel, source_type, campaign_name, broadcast_id, meta_campaign_id, meta_adset_id, meta_ad_id,
        first_touch, last_touch, ad_clicks_count, first_ad_click_at, last_ad_click_at)
     VALUES ($1::bigint, $2::text, $3::text, $4::text, $5::text, $6::bigint, $7::bigint, $8::bigint, $9::bigint,
        $10::jsonb, $10::jsonb, $11::int,
        CASE WHEN $11::int > 0 THEN NOW() ELSE NULL END,
        CASE WHEN $11::int > 0 THEN NOW() ELSE NULL END)
     ON CONFLICT (tenant_id, session_id) ${conflict}
     RETURNING *`,
    [
      safeTenant, safeSession, touch.channel, touch.source_type, touch.campaign_name || touch.meta_campaign_name,
      touch.broadcast_id, touch.meta_campaign_id, touch.meta_adset_id, touch.meta_ad_id,
      JSON.stringify(touch), clicks,
    ]
  );
  return result.rows[0] || null;
};

/** A Meta ad click (meta_ads_ad_clicks row) → a meta_ad touch on its conversation. */
export const recordAdClickTouch = async ({ tenantId, clickId } = {}) => {
  if (!Number(tenantId) || !Number(clickId)) return null;
  const { rows } = await db.query(
    `SELECT c.*, camp.name AS campaign_name, s.name AS adset_name, ad.name AS ad_name
       FROM meta_ads_ad_clicks c
       LEFT JOIN meta_ads_campaigns camp ON camp.id = c.campaign_id
       LEFT JOIN meta_ads_adsets s ON s.id = c.adset_id
       LEFT JOIN meta_ads_ads ad ON ad.id = c.ad_id
      WHERE c.tenant_id = $1 AND c.id = $2 LIMIT 1`,
    [Number(tenantId), Number(clickId)]
  );
  const click = rows[0];
  if (!click?.conversation_key) return null;
  return recordConversationTouch({
    tenantId,
    sessionId: click.conversation_key,
    adClick: true,
    touch: {
      source_type: "meta_ad",
      channel: click.channel,
      meta_campaign_id: click.campaign_id,
      meta_campaign_name: click.campaign_name,
      meta_adset_id: click.adset_id,
      meta_adset_name: click.adset_name,
      meta_ad_id: click.ad_id,
      meta_ad_name: click.ad_name,
      ad_headline: click.ad_headline,
      ad_body: click.ad_body,
      ad_source_url: click.source_url,
      ctwa_clid: click.ctwa_clid,
      attribution_status: click.attribution_status,
      via: "ad_click",
      at: click.clicked_at,
    },
  });
};

export const recordAdClickTouchSafe = (input) => recordAdClickTouch(input).catch((error) => {
  console.warn("[campaign-attribution] ad click touch failed", { tenant_id: input?.tenantId, message: clip(error?.message, 200) });
  return null;
});

/* ------------------------------------------------------------------ readers */

const loadRow = async (tenantId, sessionId) => {
  await ensureConversationAttributionSchema();
  const { rows } = await db.query(
    `SELECT * FROM inbox_conversation_attribution WHERE tenant_id = $1 AND session_id = $2::text LIMIT 1`,
    [Number(tenantId), text(sessionId)]
  );
  return rows[0] || null;
};

// The ad clicks of a conversation; [] when the Meta Ads tables do not exist on this install.
const loadClicks = async (tenantId, sessionId) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.clicked_at, c.channel, c.ad_headline, c.ad_body, c.source_url, c.post_id, c.ctwa_clid, c.attribution_status,
              c.campaign_id, c.adset_id, c.ad_id, camp.name AS campaign_name, s.name AS adset_name, ad.name AS ad_name
         FROM meta_ads_ad_clicks c
         LEFT JOIN meta_ads_campaigns camp ON camp.id = c.campaign_id
         LEFT JOIN meta_ads_adsets s ON s.id = c.adset_id
         LEFT JOIN meta_ads_ads ad ON ad.id = c.ad_id
        WHERE c.tenant_id = $1 AND c.conversation_key = $2::text
        ORDER BY c.clicked_at DESC LIMIT 50`,
      [Number(tenantId), text(sessionId)]
    );
    return rows;
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
};

export const getConversationAttribution = async ({ tenantId, sessionId } = {}) => {
  if (!Number(tenantId) || !text(sessionId)) return null;
  const [row, clicks] = await Promise.all([loadRow(tenantId, sessionId), loadClicks(tenantId, sessionId)]);
  return buildAttributionView({ row, clicks });
};

export const orderAttributionForConversation = async ({ tenantId, sessionId } = {}) => {
  const view = await getConversationAttribution({ tenantId, sessionId });
  return orderAttributionFromView(view, sessionId);
};

/**
 * The campaign instructions the AI should follow in this conversation: the active (non-expired)
 * "AI Instructions" of the Meta ad / ad set / campaign the chat came from, and a WhatsApp
 * campaign's own instructions while its reply is recent. "" when none — never throws.
 */
export const loadCampaignAiInstructions = async ({ tenantId, sessionId } = {}) => {
  try {
    if (!Number(tenantId) || !text(sessionId)) return "";
    const row = await loadRow(tenantId, sessionId).catch(() => null);
    let meta = [];
    try {
      const { getAdContextForConversation } = await import("../metaAds/integrations/adClicks.js");
      meta = (await getAdContextForConversation(Number(tenantId), text(sessionId)))?.instructions || [];
    } catch {
      meta = [];
    }
    let campaign = null;
    const touch = row?.last_touch || {};
    const touchedAt = touch.at ? new Date(touch.at).getTime() : 0;
    if (touch.source_type === "whatsapp_campaign" && touch.broadcast_id && Date.now() - touchedAt < CAMPAIGN_AI_WINDOW_DAYS * 86400000) {
      const { rows } = await db.query(
        `SELECT name, ai_instructions FROM marketing_broadcasts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [Number(tenantId), Number(touch.broadcast_id)]
      ).catch(() => ({ rows: [] }));
      if (text(rows[0]?.ai_instructions)) campaign = { name: rows[0].name, instructions: rows[0].ai_instructions };
    }
    return formatCampaignInstructions({ meta, campaign });
  } catch (error) {
    console.warn("[campaign-attribution] AI instructions not loaded", { message: clip(error?.message, 200) });
    return "";
  }
};
