import crypto from "node:crypto";

import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);

const COMBINING_MARKS_RE = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed]/g;
const ZERO_WIDTH_RE = /[\u200c\u200d\ufeff]/g;
const NON_TEXT_RE = /[^\p{L}\p{N}\s]+/gu;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\s]+$/u;

const normalizeCommentText = (value = "") =>
  text(value)
    .toLowerCase()
    .replace(COMBINING_MARKS_RE, "")
    .replace(ZERO_WIDTH_RE, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ـ/g, "")
    .replace(NON_TEXT_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

const COMMENT_INTENT_RULES = [
  {
    label: "lead_inbox",
    score: 0.98,
    patterns: [
      /\binbox\b/i,
      /\bdm\b/i,
      /\bmsg\b/i,
      /\bmessage\b/i,
      /\bprivate\b/i,
      "خاص",
      "برايفت",
      "رساله خاصه",
      "رسالة خاصة",
    ],
  },
  {
    label: "lead_price",
    score: 0.97,
    patterns: [
      /\bprice\b/i,
      "السعر",
      "السعر كام",
      "بكام",
      "بكم",
      "bkam",
      "bkam",
      "sa3r",
      "s3er",
      "s3r",
      "es3r",
      "kam",
    ],
  },
  {
    label: "lead_availability",
    score: 0.96,
    patterns: [
      /\bavailable\b/i,
      /\bavailability\b/i,
      /\bin\s*stock\b/i,
      /\bstock\b/i,
      "متاح",
      "موجود",
      "موجوده",
      "موجودة",
      "mawjood",
      "mwjod",
      "mawgood",
      "mwgood",
    ],
  },
  {
    label: "lead_size",
    score: 0.95,
    patterns: [
      /\bsize\b/i,
      /\bsizes\b/i,
      "مقاس",
      "مقاسات",
      "سايز",
      "السايز",
      /\bfit\b/i,
    ],
  },
  {
    label: "lead_shipping",
    score: 0.95,
    patterns: [
      /\bshipping\b/i,
      /\bship\b/i,
      /\bshipment\b/i,
      /\bdelivery\b/i,
      /\bdeliver(y|ies)\b/i,
      "شحن",
      "شحنه",
      "شحنة",
      "توصيل",
      "دليفري",
    ],
  },
  {
    label: "lead_details",
    score: 0.94,
    patterns: [
      /\bdetails\b/i,
      /\bdetail\b/i,
      /\binfo\b/i,
      /\binformation\b/i,
      "تفاصيل",
      "معلومات",
      "ابعت",
      "ابعتلي",
      "ابعتي",
      /\bsend\b/i,
      /\bmore\b/i,
      /\bshow\b/i,
      /\btell\s*me\b/i,
    ],
  },
];

const LOW_VALUE_PATTERNS = [
  /^(?:حلو|حلوه|حلوة|جامد|nice|wow|great|awesome|perfect|amazing|super|cool|love\s*it)$/i,
  /^(?:👍|👎|👌|👏|🔥|❤️|❤|😍|🥰|😘|💯|✨)+$/u,
];

const patternMatches = (pattern, { original = "", normalized = "", compact = "" } = {}) => {
  if (!pattern) return false;
  if (typeof pattern === "string") {
    const needle = normalizeCommentText(pattern);
    return Boolean(
      needle &&
      (normalized.includes(needle) || compact.includes(needle.replace(/\s+/g, "")) || original.toLowerCase().includes(pattern.toLowerCase()))
    );
  }
  if (pattern instanceof RegExp) {
    return pattern.test(original) || pattern.test(normalized) || pattern.test(compact);
  }
  return false;
};

export const classifySocialCommentIntent = (commentText = "") => {
  const original = text(commentText);
  const normalized = normalizeCommentText(original);
  const normalizedCompact = normalized.replace(/\s+/g, "");

  if (!original || !normalized) {
    return { label: "ignore", score: 0.99, reason: "empty_comment" };
  }

  if (EMOJI_ONLY_RE.test(original)) {
    return { label: "ignore", score: 0.99, reason: "emoji_only" };
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(normalized) || pattern.test(normalizedCompact))) {
    return { label: "engagement_only", score: 0.93, reason: "low_value_engagement" };
  }

  const matchedLabels = [];
  for (const rule of COMMENT_INTENT_RULES) {
    if (rule.patterns.some((pattern) => patternMatches(pattern, { original, normalized, compact: normalizedCompact }))) {
      matchedLabels.push(rule.label);
    }
  }

  if (!matchedLabels.length) {
    return { label: "human_review", score: 0.6, reason: "ambiguous_comment" };
  }

  if (matchedLabels.includes("lead_inbox")) {
    return { label: "lead_inbox", score: 0.98, reason: "explicit_inbox_request" };
  }

  if (matchedLabels.length === 2 && matchedLabels.includes("lead_availability")) {
    const primary = matchedLabels.find((label) => label !== "lead_availability");
    const primaryRule = COMMENT_INTENT_RULES.find((rule) => rule.label === primary);
    if (primaryRule) {
      return {
        label: primaryRule.label,
        score: primaryRule.score,
        reason: "availability_modifier",
      };
    }
  }

  if (matchedLabels.length > 1) {
    return { label: "human_review", score: 0.66, reason: "multiple_lead_intents" };
  }

  const matchedRule = COMMENT_INTENT_RULES.find((rule) => rule.label === matchedLabels[0]);
  return {
    label: matchedRule?.label || "human_review",
    score: matchedRule?.score || 0.6,
    reason: matchedRule?.label || "ambiguous_comment",
  };
};

let socialCommentSchemaReadyPromise = null;

export const ensureSocialCommentAutomationSchema = async (clientOrPool = db) => {
  if (!socialCommentSchemaReadyPromise) {
    socialCommentSchemaReadyPromise = (async () => {
      await clientOrPool.query(`
        CREATE TABLE IF NOT EXISTS social_comment_automation_runs (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL,
          platform TEXT NOT NULL,
          channel TEXT NOT NULL,
          post_id TEXT NOT NULL DEFAULT '',
          post_permalink TEXT NOT NULL DEFAULT '',
          comment_id TEXT NOT NULL,
          parent_comment_id TEXT NOT NULL DEFAULT '',
          root_comment_id TEXT NOT NULL DEFAULT '',
          commenter_id TEXT NOT NULL DEFAULT '',
          commenter_name TEXT NOT NULL DEFAULT '',
          commenter_profile_picture_url TEXT NOT NULL DEFAULT '',
          original_comment_text TEXT NOT NULL DEFAULT '',
          classification_label TEXT NULL,
          classification_score NUMERIC(6,4) NULL,
          action_taken TEXT NULL,
          public_reply_status TEXT NULL,
          dm_status TEXT NULL,
          like_status TEXT NULL,
          inbox_conversation_id TEXT NULL,
          error_code TEXT NULL,
          raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          processed_at TIMESTAMP NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (tenant_id, platform, comment_id)
        )
      `);

      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC)`);
      await clientOrPool.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id)`);
    })();
  }

  return socialCommentSchemaReadyPromise;
};

const normalizedPlatform = (body = {}) => lower(body.object) === "instagram" ? "instagram" : "facebook";
const normalizedChannel = (platform = "") => platform === "instagram" ? "instagram_comment" : "facebook_comment";

const isCommentChange = (body = {}, change = {}) => {
  const field = lower(change.field);
  const value = change.value || {};
  if (field === "feed" || field.includes("comment")) return true;
  if (body.object === "instagram" && (field === "comments" || field === "mentions")) return true;
  return Boolean(
    value.comment_id ||
    value.parent_id ||
    value.post_id ||
    value.media_id ||
    value.item === "comment"
  );
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const deriveCommentId = ({ platform = "", postId = "", parentCommentId = "", commenterId = "", commentText = "", timestamp = "", value = {}, change = {}, entry = {}, body = {} } = {}) => {
  const explicit = firstText(
    value.comment_id,
    value.id,
    value.comment?.id,
    value.commentId,
    value.comment_id_str,
    change.comment_id,
    change.id,
    entry.comment_id,
    entry.id
  );
  if (explicit) return explicit;
  const source = [
    platform,
    postId,
    parentCommentId,
    commenterId,
    commentText,
    timestamp,
    value.permalink_url || value.permalink || value.link || "",
    body.object || "",
  ].join("|");
  return `comment:${crypto.createHash("sha256").update(source).digest("hex")}`;
};

const normalizeCommentWebhookChange = ({ body = {}, entry = {}, change = {}, tenantId = null } = {}) => {
  const value = change.value || {};
  const platform = normalizedPlatform(body);
  const channel = normalizedChannel(platform);
  const postId = firstText(value.post_id, value.media_id, value.id, entry.id);
  const postPermalink = firstText(value.permalink_url, value.post_permalink, value.permalink, value.link, value.url);
  const commenterId = firstText(value.from?.id, value.from?.username, value.sender_id, value.user_id, value.commenter_id, value.author_id);
  const commenterName = firstText(value.from?.name, value.from?.username, value.username, value.commenter_name, value.author_name, value.from?.full_name);
  const commenterProfilePictureUrl = firstText(
    value.from?.profile_pic,
    value.from?.profile_picture_url,
    value.profile_picture_url,
    value.profile_pic_url,
    value.user_profile_picture,
    value.from?.picture
  );
  const originalCommentText = firstText(value.message, value.text, value.comment_text, value.caption, value.message_text);
  const timestamp = firstText(value.created_time, value.timestamp, change.created_time, change.timestamp, entry.time, entry.created_time);
  const commentId = deriveCommentId({
    platform,
    postId,
    parentCommentId: firstText(value.parent_id, value.parent_comment_id, value.parent?.id),
    commenterId,
    commentText: originalCommentText,
    timestamp,
    value,
    change,
    entry,
    body,
  });
  const parentCommentId = firstText(value.parent_id, value.parent_comment_id, value.parent?.id);
  const rootCommentId = firstText(value.root_comment_id, value.root_id, value.thread_root_id, value.thread_id, value.parent_id, value.parent_comment_id) || commentId;
  const classification = classifySocialCommentIntent(originalCommentText);

  return {
    tenant_id: tenantId,
    platform,
    channel,
    post_id: postId,
    post_permalink: postPermalink,
    comment_id: commentId,
    parent_comment_id: parentCommentId,
    root_comment_id: rootCommentId,
    commenter_id: commenterId,
    commenter_name: commenterName,
    commenter_profile_picture_url: commenterProfilePictureUrl,
    original_comment_text: originalCommentText,
    classification_label: classification.label,
    classification_score: classification.score,
    action_taken: "classified_only",
    public_reply_status: null,
    dm_status: null,
    like_status: null,
    inbox_conversation_id: null,
    error_code: null,
    raw_payload: {
      source: "meta_webhook",
      body_object: body.object || "",
      entry_id: entry.id || "",
      field: change.field || "",
      value,
      entry,
      body,
      platform,
      channel,
      comment_id: commentId,
    },
    processed_at: new Date().toISOString(),
  };
};

export const extractSocialCommentWebhookEvents = ({ body = {}, tenantId = null } = {}) => {
  const events = [];
  asArray(body.entry).forEach((entry) => {
    asArray(entry.changes).forEach((change) => {
      if (!isCommentChange(body, change)) return;
      const normalized = normalizeCommentWebhookChange({ body, entry, change, tenantId });
      if (!normalized.comment_id) return;
      events.push(normalized);
    });
  });
  return events;
};

export const storeSocialCommentAutomationRuns = async ({ tenantId = null, events = [] } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const stored = [];
  for (const event of asArray(events)) {
    const normalized = {
      tenant_id: tenantId ?? event.tenant_id,
      platform: text(event.platform || "facebook") || "facebook",
      channel: text(event.channel || (text(event.platform) === "instagram" ? "instagram_comment" : "facebook_comment")) || "facebook_comment",
      post_id: text(event.post_id || ""),
      post_permalink: text(event.post_permalink || ""),
      comment_id: text(event.comment_id || ""),
      parent_comment_id: text(event.parent_comment_id || ""),
      root_comment_id: text(event.root_comment_id || ""),
      commenter_id: text(event.commenter_id || ""),
      commenter_name: text(event.commenter_name || ""),
      commenter_profile_picture_url: text(event.commenter_profile_picture_url || ""),
      original_comment_text: text(event.original_comment_text || ""),
      classification_label: event.classification_label ?? null,
      classification_score: event.classification_score ?? null,
      action_taken: event.action_taken ?? "ingested",
      public_reply_status: event.public_reply_status ?? null,
      dm_status: event.dm_status ?? null,
      like_status: event.like_status ?? null,
      inbox_conversation_id: event.inbox_conversation_id ?? null,
      error_code: event.error_code ?? null,
      raw_payload: event.raw_payload && typeof event.raw_payload === "object" ? event.raw_payload : { raw_payload: event.raw_payload ?? null },
      processed_at: event.processed_at ? new Date(event.processed_at).toISOString() : new Date().toISOString(),
    };

    const result = await db.query(
      `
      INSERT INTO social_comment_automation_runs (
        tenant_id, platform, channel, post_id, post_permalink, comment_id, parent_comment_id, root_comment_id,
        commenter_id, commenter_name, commenter_profile_picture_url, original_comment_text, classification_label,
        classification_score, action_taken, public_reply_status, dm_status, like_status, inbox_conversation_id,
        error_code, raw_payload, processed_at, created_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19,
        $20, $21::jsonb, $22::timestamp, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
        channel = EXCLUDED.channel,
        post_id = EXCLUDED.post_id,
        post_permalink = EXCLUDED.post_permalink,
        parent_comment_id = EXCLUDED.parent_comment_id,
        root_comment_id = EXCLUDED.root_comment_id,
        commenter_id = EXCLUDED.commenter_id,
        commenter_name = COALESCE(NULLIF(EXCLUDED.commenter_name, ''), social_comment_automation_runs.commenter_name),
        commenter_profile_picture_url = COALESCE(NULLIF(EXCLUDED.commenter_profile_picture_url, ''), social_comment_automation_runs.commenter_profile_picture_url),
        original_comment_text = COALESCE(NULLIF(EXCLUDED.original_comment_text, ''), social_comment_automation_runs.original_comment_text),
        classification_label = COALESCE(social_comment_automation_runs.classification_label, EXCLUDED.classification_label),
        classification_score = COALESCE(social_comment_automation_runs.classification_score, EXCLUDED.classification_score),
        action_taken = CASE
          WHEN social_comment_automation_runs.action_taken IS NULL OR social_comment_automation_runs.action_taken = 'ingested'
            THEN EXCLUDED.action_taken
          ELSE social_comment_automation_runs.action_taken
        END,
        public_reply_status = COALESCE(social_comment_automation_runs.public_reply_status, EXCLUDED.public_reply_status),
        dm_status = COALESCE(social_comment_automation_runs.dm_status, EXCLUDED.dm_status),
        like_status = COALESCE(social_comment_automation_runs.like_status, EXCLUDED.like_status),
        inbox_conversation_id = COALESCE(social_comment_automation_runs.inbox_conversation_id, EXCLUDED.inbox_conversation_id),
        error_code = COALESCE(social_comment_automation_runs.error_code, EXCLUDED.error_code),
        raw_payload = EXCLUDED.raw_payload,
        processed_at = COALESCE(social_comment_automation_runs.processed_at, EXCLUDED.processed_at),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        normalized.tenant_id,
        normalized.platform,
        normalized.channel,
        normalized.post_id,
        normalized.post_permalink,
        normalized.comment_id,
        normalized.parent_comment_id,
        normalized.root_comment_id,
        normalized.commenter_id,
        normalized.commenter_name,
        normalized.commenter_profile_picture_url,
        normalized.original_comment_text,
        normalized.classification_label,
        normalized.classification_score,
        normalized.action_taken,
        normalized.public_reply_status,
        normalized.dm_status,
        normalized.like_status,
        normalized.inbox_conversation_id,
        normalized.error_code,
        JSON.stringify(normalized.raw_payload || {}),
        normalized.processed_at,
      ]
    );
    stored.push(result.rows[0] || normalized);
  }
  return stored;
};

export const listRecentSocialCommentAutomationRuns = async ({ tenantId = null, limit = 50 } = {}) => {
  await ensureSocialCommentAutomationSchema();
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_automation_runs
    WHERE tenant_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2
    `,
    [tenantId, safeLimit]
  );
  return result.rows;
};
