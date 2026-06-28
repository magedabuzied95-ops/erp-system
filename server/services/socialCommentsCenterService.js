import db from "../database/db.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import { fetchMetaPostPreviewDetails } from "./metaIntegrationService.js";
import { likeComment, replyToComment, renderTemplate } from "./marketingCommentAutomationService.js";
import { getMappings } from "./postProductMappingService.js";
import { emitSocialCommentNew, emitSocialCommentUpdated, emitSocialReplyStatus } from "./socialRealtimeService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isSocialCommentsDebugEnabled = () => String(process.env.DEBUG_SOCIAL_COMMENTS || "").toLowerCase() === "true";
const debugSocialCommentsWarn = (...args) => {
  if (isSocialCommentsDebugEnabled()) console.warn(...args);
};
const toBool = (value, fallback = false) => {
  if (value === null || typeof value === "undefined" || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(lower(value));
};
const toTenantId = (value) => Number(value) || 0;

const SOCIAL_AUTO_REPLY_DEFAULTS = {
  generic_enabled: false,
  generic_like_enabled: true,
  generic_reply_enabled: true,
  generic_template: "تم الرد على حضرتك في الخاص ✅",
  mode: "manual_approval",
};

const SOCIAL_AUTO_REPLY_MODES = new Set(["off", "draft", "manual_approval", "full_auto"]);

const ensureSocialCommentsCenterSchema = async () => {
  await ensureAiSalesAgentSchema().catch(() => {});
  await ensureAiSupportLogSchema().catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_auto_reply_settings (
      tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      generic_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      generic_like_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      generic_reply_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      generic_template TEXT NOT NULL DEFAULT '',
      mode VARCHAR(40) NOT NULL DEFAULT 'manual_approval',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_post_auto_reply_templates (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
      post_id TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      like_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      reply_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      template TEXT NOT NULL DEFAULT '',
      mode VARCHAR(40) NOT NULL DEFAULT 'manual_approval',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, platform, post_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_comment_post_automation_configs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL,
      platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
      product_id BIGINT NULL REFERENCES products(id) ON DELETE SET NULL,
      template_key TEXT NOT NULL DEFAULT '',
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      message_templates JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, post_id, platform)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS social_comment_auto_reply_runs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      platform VARCHAR(30) NOT NULL DEFAULT 'facebook',
      post_id TEXT NOT NULL DEFAULT '',
      comment_id TEXT NOT NULL DEFAULT '',
      template_source TEXT NOT NULL DEFAULT '',
      rendered_reply TEXT NOT NULL DEFAULT '',
      like_status TEXT NOT NULL DEFAULT 'pending',
      reply_status TEXT NOT NULL DEFAULT 'pending',
      mode TEXT NOT NULL DEFAULT 'manual_approval',
      decision_reason TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at TIMESTAMP NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, platform, comment_id)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS marketing_post_product_links (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL,
      platform TEXT NOT NULL,
      platform_post_id TEXT NOT NULL,
      product_id BIGINT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 1,
      is_primary BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (tenant_id, platform, platform_post_id, product_id)
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS social_comment_auto_reply_runs ADD COLUMN IF NOT EXISTS reply_status TEXT NOT NULL DEFAULT 'pending'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_auto_reply_settings_updated ON social_auto_reply_settings (updated_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_post_auto_reply_templates_lookup ON social_post_auto_reply_templates (tenant_id, platform, post_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_post_automation_configs_lookup ON social_comment_post_automation_configs (tenant_id, post_id, platform)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_auto_reply_runs_lookup ON social_comment_auto_reply_runs (tenant_id, platform, comment_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_fast_list ON social_comment_automation_runs (tenant_id, platform, updated_at DESC, id DESC)`);
};

const normalizePlatform = (value = "") => (lower(value) === "instagram" ? "instagram" : "facebook");
const isInstagram = (value = "") => normalizePlatform(value) === "instagram";
const isFacebook = (value = "") => normalizePlatform(value) === "facebook";

const cleanCommentText = (value = "") => text(value);

const metadataObject = (value = {}) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const SOCIAL_COMMENT_THUMBNAIL_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='18' fill='%23f3f4f6'/%3E%3Cpath d='M18 67l17-17 11 11 9-9 23 23H18z' fill='%23d1d5db'/%3E%3Ccircle cx='37' cy='35' r='7' fill='%23d1d5db'/%3E%3C/svg%3E";

const isUsableImageUrl = (value = "") => {
  const image = text(value);
  if (!image) return false;
  if (image === SOCIAL_COMMENT_THUMBNAIL_PLACEHOLDER) return false;
  if (image.includes("/favicon.svg")) return false;
  return true;
};

const firstImageValue = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = firstImageValue(...value);
      if (nested) return nested;
      continue;
    }
    if (value && typeof value === "object") {
      const nested = firstImageValue(
        value.image_url,
        value.url,
        value.path,
        value.src,
        value.preview,
        value.secure_url,
        value.thumbnail_url,
        value.image?.src,
        value.image?.url,
        value.media?.image?.src,
        value.media?.image_url,
        value.media?.source
      );
      if (nested) return nested;
      continue;
    }
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
};

const extractAttachmentThumbnail = (attachments = []) => {
  const safeAttachments = asArray(attachments);
  for (const attachment of safeAttachments) {
    const image =
      attachment?.media?.image?.src ||
      attachment?.media?.image_url ||
      attachment?.media?.source ||
      attachment?.subattachments?.data?.[0]?.media?.image?.src ||
      attachment?.subattachments?.data?.[0]?.media?.image_url ||
      attachment?.subattachments?.data?.[0]?.media?.source ||
      attachment?.subattachments?.[0]?.media?.image?.src ||
      attachment?.subattachments?.[0]?.media?.image_url ||
      attachment?.subattachments?.[0]?.media?.source ||
      "";
    if (text(image)) return text(image);
  }
  return "";
};

const resolvePostThumbnailDetails = (row = {}) => {
  const metadata = metadataObject(row.metadata || {});
  const attachments = asArray(metadata.attachments || row.attachments || []);
  const storedReasonIfMissing = text(metadata.reason_if_missing || row.reason_if_missing || "");
  const storedMediaStatus = text(metadata.media_enrichment_status || row.media_enrichment_status || "");

  const directSources = [
    ["post_thumbnail", row.post_thumbnail || metadata.post_thumbnail || metadata.thumbnail_url || ""],
    ["post_full_picture", row.post_full_picture || metadata.post_full_picture || metadata.full_picture || ""],
    ["attachment_image", row.attachment_image || metadata.attachment_image || ""],
    ["full_picture", row.full_picture || metadata.full_picture || ""],
    ["picture", row.picture || metadata.picture || ""],
    ["source", row.source || metadata.source || ""],
  ];

  for (const [source, value] of directSources) {
    const image = text(value);
    if (isUsableImageUrl(image)) {
      return {
        thumbnail_url: image,
        thumbnail_source: source,
        has_thumbnail: true,
        reason_if_missing: "",
        graph_enriched: false,
      };
    }
  }

  const attachmentImage = extractAttachmentThumbnail(attachments);
  if (isUsableImageUrl(attachmentImage)) {
    return {
      thumbnail_url: attachmentImage,
      thumbnail_source: "attachments.media.image.src",
      has_thumbnail: true,
      reason_if_missing: "",
      graph_enriched: false,
    };
  }

  const productImage = firstImageValue(
    row.product_image_url,
    row.product_image,
    metadata.product_image_url,
    metadata.product_image
  );
  if (isUsableImageUrl(productImage)) {
    return {
      thumbnail_url: productImage,
      thumbnail_source: "product_image",
      has_thumbnail: true,
      reason_if_missing: "",
      graph_enriched: false,
    };
  }

  const productGalleryImage = firstImageValue(
    row.product_gallery_images,
    row.product_variant_images,
    row.gallery_images,
    row.product_images,
    metadata.product_gallery_images,
    metadata.product_variant_images,
    metadata.gallery_images,
    metadata.product_images
  );
  if (isUsableImageUrl(productGalleryImage)) {
    return {
      thumbnail_url: productGalleryImage,
      thumbnail_source: "product_images[0]",
      has_thumbnail: true,
      reason_if_missing: "",
      graph_enriched: false,
    };
  }

  return {
    thumbnail_url: null,
    thumbnail_source: "missing",
    has_thumbnail: false,
    reason_if_missing: storedReasonIfMissing || (storedMediaStatus === "unsupported_deprecated_status" ? "deprecated_status_no_graph_media" : "no_image_sources_found"),
    graph_enriched: false,
  };
};

const resolvePostPreviewImage = (row = {}) => resolvePostThumbnailDetails(row).thumbnail_url;

const resolvePostPreviewCaption = (row = {}) => {
  const metadata = metadataObject(row.metadata || {});
  return text(
    row.post_caption ||
      row.post_message ||
      row.last_message ||
      row.post_text ||
      row.message ||
      metadata.post_caption ||
      metadata.post_message ||
      metadata.caption ||
      metadata.message ||
      ""
  );
};

const resolvePostPreviewLink = (row = {}) => {
  const metadata = metadataObject(row.metadata || {});
  return text(
    row.post_permalink ||
      row.post_permalink_url ||
      row.permalink_url ||
      row.post_url ||
      metadata.post_permalink ||
      metadata.post_permalink_url ||
      metadata.permalink_url ||
      metadata.post_url ||
      ""
  );
};

const isWrapperSocialCommentPostId = (value = "") => /^(social_comment|facebook_comment|instagram_comment):/i.test(text(value));

const resolveSocialCommentGraphPostId = (row = {}) => {
  const metadata = metadataObject(row.metadata || {});
  const candidates = [
    metadata.post_id,
    row.automation_run_post_id,
    row.raw_payload?.value?.post_id,
    row.raw_payload?.post_id,
    row.post_id,
    row.external_conversation_id,
    row.conversation_id,
    metadata.conversation_id,
  ]
    .map((value) => text(value))
    .filter(Boolean);

  for (const candidate of candidates) {
    if (/^(facebook|instagram)_post:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      return text(parts.slice(1).join(":"));
    }
    if (/^(facebook|instagram)_comment:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      if (parts.length >= 3) return text(parts[1] || "");
      return text(parts[1] || "");
    }
    if (/^social_comment:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      if (parts.length >= 3) {
        const tail = text(parts.slice(2).join(":"));
        if (tail) return tail;
      }
      if (parts.length >= 2) {
        return text(parts[parts.length - 1] || "");
      }
    }
    if (!isWrapperSocialCommentPostId(candidate)) {
      return candidate;
    }
    return candidate;
  }

  return "";
};

const resolveSocialCommentGraphLookupIds = ({ row = {}, pageId = "" } = {}) => {
  const metadata = metadataObject(row.metadata || {});
  const safePageId = text(pageId);
  const rawCandidates = [
    resolveSocialCommentGraphPostId(row),
    row.automation_run_post_id,
    row.raw_payload?.value?.post_id,
    row.raw_payload?.post_id,
    row.post_id,
    metadata.post_id,
    row.conversation_id,
    row.external_conversation_id,
    metadata.conversation_id,
  ]
    .map((value) => text(value))
    .filter(Boolean);

  const lookupIds = [];
  for (const candidate of rawCandidates) {
    if (/^(facebook|instagram)_post:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      const graphPostId = text(parts.slice(1).join(":"));
      if (graphPostId) lookupIds.push(graphPostId);
      continue;
    }
    if (/^(facebook|instagram)_comment:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      const graphPostId = text(parts[1] || "");
      if (graphPostId) {
        if (safePageId && !graphPostId.startsWith(`${safePageId}_`)) {
          const baseGraphPostId = text(graphPostId.split("_").slice(0, 1).join("_") || "");
          if (baseGraphPostId) lookupIds.push(`${safePageId}_${baseGraphPostId}`);
        }
        lookupIds.push(graphPostId);
      }
      continue;
    }
    if (/^social_comment:/i.test(candidate)) {
      const parts = candidate.split(":").filter(Boolean);
      const graphPostId = text(parts.slice(2).join(":") || parts[parts.length - 1] || "");
      if (graphPostId) {
        if (safePageId) {
          const baseGraphPostId = text(graphPostId.split("_").slice(0, 1).join("_") || "");
          if (baseGraphPostId) lookupIds.push(`${safePageId}_${baseGraphPostId}`);
        }
        lookupIds.push(graphPostId);
      }
      continue;
    }
    if (safePageId && candidate.includes("_") && !candidate.startsWith(`${safePageId}_`)) {
      const baseGraphPostId = text(candidate.split("_").slice(0, 1).join("_") || "");
      if (baseGraphPostId) lookupIds.push(`${safePageId}_${baseGraphPostId}`);
    }
    if (!/^(facebook|instagram|social_comment)_/i.test(candidate)) {
      lookupIds.push(candidate);
    }
  }

  return Array.from(new Set(lookupIds.filter(Boolean)));
};

const normalizeSocialCommentPostIdCandidate = ({ value = "", pageId = "", source = "" } = {}) => {
  let candidate = text(value);
  const safePageId = text(pageId);
  const sourceKey = lower(source);
  if (!candidate) return "";
  candidate = candidate
    .replace(/^(social_comment|facebook_comment|instagram_comment|facebook_post|instagram_post):/i, "")
    .replace(/^(facebook|instagram):/i, "")
    .split(":")[0]
    .trim();
  if (!candidate) return "";
  const parts = candidate.split("_").filter(Boolean);
  if (parts.length >= 3) {
    if (safePageId && parts[0] === safePageId) return `${parts[0]}_${parts[1]}`;
    return `${parts[0]}_${parts[1]}`;
  }
  if (parts.length === 2) {
    if (safePageId && parts[0] !== safePageId && ["metadata.post_id", "automation_run_post_id", "raw_payload.value.post_id", "raw_payload.post_id", "post_id", "conversation_id", "external_conversation_id", "metadata.conversation_id"].includes(sourceKey)) {
      return `${safePageId}_${parts[0]}`;
    }
    return candidate;
  }
  if (parts.length === 1 && safePageId) {
    return `${safePageId}_${parts[0]}`;
  }
  return candidate;
};

const resolveSocialCommentCanonicalPostId = (row = {}) => {
  const metadata = metadataObject(row.metadata || {});
  const rawPayload = metadataObject(row.automation_run_raw_payload || row.raw_payload || {});
  const valuePayload = metadataObject(rawPayload.value || {});
  const pageId = text(metadata.page_id || metadata.facebook_page_id || rawPayload.value?.page_id || rawPayload.value?.facebook_page_id || rawPayload.page_id || rawPayload.facebook_page_id || "");
  const candidates = [
    { source: "metadata.post_id", value: metadata.post_id },
    { source: "automation_run_post_id", value: row.automation_run_post_id },
    { source: "raw_payload.value.post_id", value: valuePayload.post_id },
    { source: "raw_payload.post_id", value: rawPayload.post_id },
    { source: "post_id", value: row.post_id },
    { source: "conversation_id", value: row.conversation_id },
    { source: "external_conversation_id", value: row.external_conversation_id },
    { source: "metadata.conversation_id", value: metadata.conversation_id },
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSocialCommentPostIdCandidate({ value: candidate.value, pageId, source: candidate.source });
    if (normalized) return normalized;
  }

  return "";
};

const canonicalizeSocialCommentThreadPostId = ({ postId = "", platform = "", pageId = "" } = {}) => {
  const safePostId = text(postId);
  const safePageId = text(pageId);
  if (!safePostId) return "";
  const normalizedPlatform = normalizePlatform(platform);
  const candidates = [
    { source: "input", value: safePostId },
    { source: "wrapped_session", value: `social_comment:${normalizedPlatform}:${safePostId}` },
    { source: "wrapped_platform", value: `${normalizedPlatform}_post:${safePostId}` },
  ];
  for (const candidate of candidates) {
    const normalized = normalizeSocialCommentPostIdCandidate({ value: candidate.value, pageId: safePageId, source: candidate.source });
    if (normalized) return normalized;
  }
  return safePostId;
};

const buildSocialCommentThreadSessionVariants = ({ postId = "", platform = "", pageId = "" } = {}) => {
  const safePostId = text(postId);
  const normalizedPlatform = normalizePlatform(platform);
  const safePageId = text(pageId);
  const variants = new Set();
  const push = (value = "") => {
    const candidate = text(value);
    if (candidate) variants.add(candidate);
  };
  push(safePostId);
  push(`${normalizedPlatform}_post:${safePostId}`);
  push(`social_comment:${normalizedPlatform}:${safePostId}`);
  const normalized = canonicalizeSocialCommentThreadPostId({ postId: safePostId, platform: normalizedPlatform, pageId: safePageId });
  push(normalized);
  push(`${normalizedPlatform}_post:${normalized}`);
  push(`social_comment:${normalizedPlatform}:${normalized}`);
  if (safePageId && safePostId && !safePostId.startsWith(`${safePageId}_`)) {
    const tailParts = safePostId.split("_").filter(Boolean);
    if (tailParts.length >= 1) {
      push(`${safePageId}_${tailParts[0]}`);
      push(`${normalizedPlatform}_post:${safePageId}_${tailParts[0]}`);
      push(`social_comment:${normalizedPlatform}:${safePageId}_${tailParts[0]}`);
    }
  }
  return Array.from(variants);
};

const persistSocialCommentPostMedia = async ({ tenantId = null, channel = "", conversationId = "", metadata = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeChannel = text(channel);
  const safeConversationId = text(conversationId);
  const safeMetadata = metadataObject(metadata);
  if (!safeTenantId || !safeChannel || !safeConversationId || !Object.keys(safeMetadata).length) return;
  await db.query(
    `
    UPDATE ai_channel_conversations
    SET metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
        updated_at = NOW()
    WHERE tenant_id = $1::bigint
      AND channel = $2::text
      AND external_conversation_id = $3::text
    `,
    [safeTenantId, safeChannel, safeConversationId, JSON.stringify(safeMetadata)]
  ).catch(() => {});
};

const extractPermalinkObjectId = (value = "") => {
  const permalink = text(value);
  if (!permalink) return "";
  const patterns = [
    /facebook\.com\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/[^/]+\/videos\/(\d+)/i,
    /facebook\.com\/photo\.php\?(?:[^#&]*&)*fbid=(\d+)/i,
    /facebook\.com\/permalink\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
    /facebook\.com\/story\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = permalink.match(pattern);
    if (match?.[1]) return text(match[1]);
  }
  return "";
};

const loadSocialPublisherFallbackMedia = async ({ tenantId = null, postId = "", permalinkUrl = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  const safePermalinkUrl = text(permalinkUrl);
  if (!safeTenantId) return null;
  const extractedPermalinkObjectId = extractPermalinkObjectId(safePermalinkUrl);
  const candidateIds = Array.from(new Set([safePostId, extractedPermalinkObjectId].filter((value) => Boolean(value) && !String(value).includes(":"))));
  const candidatePermalinks = Array.from(new Set([safePermalinkUrl].filter(Boolean)));
  if (!candidateIds.length && !candidatePermalinks.length) return null;
  const conditions = [];
  const values = [safeTenantId];
  let paramIndex = 2;
  if (candidateIds.length) {
    conditions.push(`(platform_post_id = ANY($${paramIndex}::text[]) OR NULLIF(metadata->>'platform_post_id', '') = ANY($${paramIndex}::text[]) OR NULLIF(metadata->>'external_post_id', '') = ANY($${paramIndex}::text[]) OR NULLIF(metadata->>'post_id', '') = ANY($${paramIndex}::text[]))`);
    values.push(candidateIds);
    paramIndex += 1;
  }
  if (candidatePermalinks.length) {
    conditions.push(`(NULLIF(metadata->>'permalink_url', '') = ANY($${paramIndex}::text[]) OR NULLIF(metadata->>'post_permalink_url', '') = ANY($${paramIndex}::text[]) OR NULLIF(metadata->>'post_url', '') = ANY($${paramIndex}::text[]))`);
    values.push(candidatePermalinks);
    paramIndex += 1;
  }
  if (!conditions.length) return null;
  const result = await db.query(
    `
    SELECT
      id,
      platform_post_id,
      COALESCE(NULLIF(final_asset_url, ''), NULLIF(rendered_image_url, ''), NULLIF(story_image_url, ''), NULLIF(primary_image_url, ''), NULLIF(variant_image_url, ''), NULLIF(image_url, '')) AS candidate_image_url,
      COALESCE(NULLIF(metadata->>'final_asset_url', ''), NULLIF(metadata->>'rendered_image_url', ''), NULLIF(metadata->>'story_image_url', ''), NULLIF(metadata->>'primary_image_url', ''), NULLIF(metadata->>'variant_image_url', ''), NULLIF(metadata->>'image_url', '')) AS metadata_image_url,
      COALESCE(NULLIF(metadata->>'permalink_url', ''), NULLIF(metadata->>'post_permalink_url', ''), NULLIF(metadata->>'post_url', ''), NULLIF(metadata->>'external_post_url', '')) AS metadata_permalink_url
    FROM ai_marketing_content_queue
    WHERE tenant_id = $1::bigint
      AND (${conditions.join(" OR ")})
    ORDER BY updated_at DESC, created_at DESC, id DESC
    LIMIT 1
    `,
    values
  ).catch(() => ({ rows: [] }));
  const row = result.rows?.[0] || null;
  if (!row) return null;
  const fallbackImage = text(row.candidate_image_url || row.metadata_image_url || "");
  if (!isUsableImageUrl(fallbackImage)) return null;
  return {
    thumbnail_url: fallbackImage,
    thumbnail_source: "marketing_content_queue",
    source_post_id: text(row.platform_post_id || ""),
    source_permalink_url: text(row.metadata_permalink_url || safePermalinkUrl || ""),
    publisher_record_id: text(row.id || ""),
  };
};

const enrichSocialCommentPostRow = async ({ tenantId = null, row = {}, platform = "" } = {}) => {
  const safeRow = { ...(row || {}) };
  const metadata = metadataObject(safeRow.metadata || {});
  const storedPostId = text(
    metadata.post_id ||
    safeRow.automation_run_post_id ||
    safeRow.raw_payload?.value?.post_id ||
    safeRow.raw_payload?.post_id ||
    ""
  ) || (safeRow.post_id && !isWrapperSocialCommentPostId(safeRow.post_id) ? text(safeRow.post_id) : "");
  const postId = storedPostId || text(safeRow.post_id || safeRow.conversation_id || metadata.conversation_id || "");
  const graphPostId = resolveSocialCommentGraphPostId(safeRow);
  const pageId = text(metadata.page_id || metadata.facebook_page_id || "");
  const graphLookupPostIds = resolveSocialCommentGraphLookupIds({ row: safeRow, pageId });
  const currentDetails = resolvePostThumbnailDetails(safeRow);
  const currentHasThumbnail = Boolean(currentDetails.has_thumbnail);
  const shouldLogMediaBackfill = !currentHasThumbnail;
  const mappingSummary = postId && tenantId
    ? await getMappings({ tenantId, platform, postId, row: safeRow, post: safeRow }).catch(() => null)
    : null;
  const appendMappingSummary = (value = {}) => ({
    ...value,
    linked_products: mappingSummary?.linked_products || [],
    primary_linked_product: mappingSummary?.primary_product || null,
    primary_product: mappingSummary?.primary_product || null,
    primary_product_name: text(mappingSummary?.primary_product?.name || mappingSummary?.primary_product?.title || mappingSummary?.primary_product?.product_name || ""),
    product_id: mappingSummary?.primary_product?.product_id || mappingSummary?.primary_product?.id || value.product_id || safeRow.product_id || null,
    product_name: text(mappingSummary?.primary_product?.name || mappingSummary?.primary_product?.title || mappingSummary?.primary_product?.product_name || value.product_name || safeRow.product_name || ""),
    product_price: mappingSummary?.primary_product?.price ?? mappingSummary?.primary_product?.final_price ?? mappingSummary?.primary_product?.sale_price ?? value.product_price ?? safeRow.product_price ?? null,
    product_sale_price: mappingSummary?.primary_product?.sale_price ?? mappingSummary?.primary_product?.final_price ?? value.product_sale_price ?? safeRow.product_sale_price ?? null,
    product_image_url: text(mappingSummary?.primary_product?.image_url || value.product_image_url || safeRow.product_image_url || ""),
    product_storefront_url: text(mappingSummary?.primary_product?.storefront_url || mappingSummary?.primary_product?.product_url || value.product_storefront_url || safeRow.product_storefront_url || ""),
    product_sizes: text(mappingSummary?.primary_product?.available_sizes?.join ? mappingSummary.primary_product.available_sizes.join(", ") : mappingSummary?.primary_product?.sizes || value.product_sizes || safeRow.product_sizes || ""),
    product_colors: text(mappingSummary?.primary_product?.available_colors?.join ? mappingSummary.primary_product.available_colors.join(", ") : mappingSummary?.primary_product?.colors || value.product_colors || safeRow.product_colors || ""),
    linked_products_count: Number(mappingSummary?.count || 0) || 0,
    product_links_count: Number(mappingSummary?.count || 0) || 0,
    mapping_summary: mappingSummary || null,
  });
  const hasAnyMediaBefore = Boolean(
    currentDetails.has_thumbnail ||
    currentDetails.thumbnail_url ||
    safeRow.thumbnail_url ||
    metadata.thumbnail_url ||
    safeRow.post_thumbnail ||
    metadata.post_thumbnail ||
    safeRow.post_full_picture ||
    metadata.post_full_picture ||
    safeRow.full_picture ||
    metadata.full_picture ||
    safeRow.picture ||
    metadata.picture ||
    safeRow.attachment_image ||
    metadata.attachment_image ||
    safeRow.media_url ||
    metadata.media_url ||
    safeRow.image_url ||
    metadata.image_url ||
    safeRow.image ||
    metadata.image
  );
  const unsupportedGraphMedia = currentDetails.reason_if_missing === "deprecated_status_no_graph_media" || lower(metadata.media_enrichment_status) === "unsupported_deprecated_status";
  const needsGraph = !currentDetails.has_thumbnail || !resolvePostPreviewCaption(safeRow) || !resolvePostPreviewLink(safeRow);
  if (!tenantId || !postId || !needsGraph) {
    return appendMappingSummary({
      ...safeRow,
      had_thumbnail_before: currentHasThumbnail,
      thumbnail_url: currentDetails.thumbnail_url,
      thumbnail_source: currentDetails.thumbnail_source,
      has_thumbnail: currentDetails.has_thumbnail,
      post_type: text(safeRow.post_type || metadata.post_type || ""),
      media_type: text(safeRow.media_type || metadata.media_type || ""),
      graph_fields_present: asArray(safeRow.graph_fields_present || metadata.graph_fields_present || []),
      attachments_shape: metadataObject(safeRow.attachments_shape || metadata.attachments_shape || {}),
      full_picture_present: Boolean(safeRow.full_picture_present ?? metadata.full_picture_present),
      attachment_image_present: Boolean(safeRow.attachment_image_present ?? metadata.attachment_image_present),
      graph_enriched: false,
      fallback_enriched: false,
      reason_if_missing: currentDetails.reason_if_missing || "",
      media_enrichment_status: unsupportedGraphMedia ? "unsupported_deprecated_status" : text(metadata.media_enrichment_status || ""),
      tried_ids: [],
      tried_graph_ids: [],
      skipped_non_graph_ids: [],
      graph_errors_sample: [],
      normalized_post_id: postId,
      source_post_id: postId,
      extracted_permalink_object_id: "",
      reel_id_from_permalink: "",
      reel_thumbnail_present: false,
      object_id_thumbnail_present: false,
    });
  }
  const permalinkUrl = safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || "";
  const graphLookupFallbackPostIds = Array.from(new Set([
    ...(graphLookupPostIds.length ? graphLookupPostIds : [text(graphPostId || "")]),
    text(graphPostId || ""),
  ].filter(Boolean)));
  try {
    if (shouldLogMediaBackfill) {
      console.warn("[social-comments:media-backfill:start]", {
        conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || ""),
        post_id: postId,
        metadata_post_id: text(metadata.post_id || ""),
        resolved_graph_id: text(graphLookupFallbackPostIds[0] || graphPostId || ""),
        has_any_media_before: hasAnyMediaBefore,
      });
    }
    let graphPost = null;
    let resolvedGraphId = "";
    let graphErrorMessage = "";
    for (const candidatePostId of graphLookupFallbackPostIds) {
      if (shouldLogMediaBackfill) {
        console.warn("[social-comments:graph-fetch]", {
          graphLookupPostId: candidatePostId,
        });
      }
      const candidateGraphPost = await fetchMetaPostPreviewDetails({
        tenantId,
        postId: candidatePostId,
        pageId,
        permalinkUrl,
      }).catch((error) => {
        graphErrorMessage = text(error?.message || graphErrorMessage || "");
        return null;
      });
      if (!candidateGraphPost) continue;
      graphPost = candidateGraphPost;
      resolvedGraphId = candidatePostId;
      const candidateDetails = resolvePostThumbnailDetails(candidateGraphPost);
      if (candidateDetails.has_thumbnail || isUsableImageUrl(candidateDetails.thumbnail_url)) {
        break;
      }
    }
    if (!resolvedGraphId) {
      resolvedGraphId = text(graphLookupFallbackPostIds[0] || graphPostId || "");
    }
    const graphUnsupported = text(graphPost?.reason_if_missing || "") === "deprecated_status_no_graph_media" || lower(graphPost?.media_enrichment_status) === "unsupported_deprecated_status";
    if (!graphPost || graphUnsupported) {
      const fallbackMedia = await loadSocialPublisherFallbackMedia({
        tenantId,
        postId,
        permalinkUrl: safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || "",
      }).catch(() => null);
      if (fallbackMedia) {
        const fallbackMetadata = {
          ...metadata,
          post_id: postId,
          thumbnail_url: fallbackMedia.thumbnail_url,
          post_full_picture: fallbackMedia.thumbnail_url,
          full_picture: fallbackMedia.thumbnail_url,
          picture: fallbackMedia.thumbnail_url,
          media_url: "",
          media_type: metadata.media_type || "",
          thumbnail_source: fallbackMedia.thumbnail_source,
          fallback_media_source: "marketing_content_queue",
          fallback_record_id: fallbackMedia.publisher_record_id || "",
          fallback_source_post_id: fallbackMedia.source_post_id || "",
          fallback_source_permalink_url: fallbackMedia.source_permalink_url || "",
        };
        await persistSocialCommentPostMedia({
          tenantId,
          channel: safeRow.channel || (normalizePlatform(platform) === "instagram" ? "instagram_comment" : "facebook_comment"),
          conversationId: safeRow.conversation_id || safeRow.external_conversation_id || "",
          metadata: fallbackMetadata,
        });
        if (shouldLogMediaBackfill) {
          console.warn("[social-comments:media-backfill:result]", {
            conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || ""),
            original_post_id: postId,
            resolved_graph_id: resolvedGraphId,
            graph_media_found: false,
            media_source_used: fallbackMedia.thumbnail_source || "marketing_content_queue",
            thumbnail_url_saved: text(fallbackMedia.thumbnail_url || ""),
            error_message: text(graphErrorMessage || graphPost?.reason_if_missing || ""),
          });
        }
        return appendMappingSummary({
          ...safeRow,
          metadata: fallbackMetadata,
          had_thumbnail_before: currentHasThumbnail,
          thumbnail_url: fallbackMedia.thumbnail_url,
          thumbnail_source: fallbackMedia.thumbnail_source,
          has_thumbnail: true,
          thumbnail_saved: true,
          media_enrichment_status: "fallback_enriched",
          post_type: text(safeRow.post_type || metadata.post_type || ""),
          media_type: text(safeRow.media_type || metadata.media_type || ""),
          graph_fields_present: asArray(safeRow.graph_fields_present || metadata.graph_fields_present || []),
          attachments_shape: metadataObject(safeRow.attachments_shape || metadata.attachments_shape || {}),
          full_picture_present: Boolean(safeRow.full_picture_present ?? metadata.full_picture_present),
          attachment_image_present: Boolean(safeRow.attachment_image_present ?? metadata.attachment_image_present),
          graph_enriched: false,
          fallback_enriched: true,
          reason_if_missing: "",
          tried_ids: [],
          tried_graph_ids: [],
          skipped_non_graph_ids: [],
          graph_errors_sample: [],
          normalized_post_id: postId,
          source_post_id: postId,
          extracted_permalink_object_id: extractPermalinkObjectId(safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || ""),
          reel_id_from_permalink: "",
          reel_thumbnail_present: false,
          object_id_thumbnail_present: false,
        });
      }
      if (graphUnsupported) {
        const unsupportedMetadata = {
          ...metadata,
          post_id: postId,
          reason_if_missing: "deprecated_status_no_graph_media",
          media_enrichment_status: "unsupported_deprecated_status",
          graph_enriched: false,
          fallback_enriched: false,
          thumbnail_url: "",
          thumbnail_source: "missing",
          has_thumbnail: false,
        };
        await persistSocialCommentPostMedia({
          tenantId,
          channel: safeRow.channel || (normalizePlatform(platform) === "instagram" ? "instagram_comment" : "facebook_comment"),
          conversationId: safeRow.conversation_id || safeRow.external_conversation_id || "",
          metadata: unsupportedMetadata,
        });
        if (shouldLogMediaBackfill) {
          console.warn("[social-comments:media-backfill:result]", {
            conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || ""),
            original_post_id: postId,
            resolved_graph_id: resolvedGraphId,
            graph_media_found: false,
            media_source_used: "deprecated_status_no_graph_media",
            thumbnail_url_saved: "",
            error_message: text(graphErrorMessage || graphPost?.reason_if_missing || ""),
          });
        }
        return appendMappingSummary({
          ...safeRow,
          metadata: unsupportedMetadata,
          had_thumbnail_before: currentHasThumbnail,
          thumbnail_url: currentDetails.thumbnail_url,
          thumbnail_source: currentDetails.thumbnail_source,
          has_thumbnail: currentDetails.has_thumbnail,
          graph_enriched: false,
          fallback_enriched: false,
          media_enrichment_status: "unsupported_deprecated_status",
          reason_if_missing: "deprecated_status_no_graph_media",
          tried_ids: [],
          tried_graph_ids: [],
          skipped_non_graph_ids: [],
          graph_errors_sample: [],
          normalized_post_id: postId,
          source_post_id: postId,
          extracted_permalink_object_id: extractPermalinkObjectId(safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || ""),
          reel_id_from_permalink: "",
          reel_thumbnail_present: false,
          object_id_thumbnail_present: false,
        });
      }
      return appendMappingSummary({
        ...safeRow,
        had_thumbnail_before: currentHasThumbnail,
        thumbnail_url: currentDetails.thumbnail_url,
        thumbnail_source: currentDetails.thumbnail_source,
        has_thumbnail: currentDetails.has_thumbnail,
        graph_enriched: false,
        fallback_enriched: false,
        reason_if_missing: currentDetails.reason_if_missing || "graph_unavailable",
        media_enrichment_status: text(metadata.media_enrichment_status || ""),
        tried_ids: [],
        tried_graph_ids: [],
        skipped_non_graph_ids: [],
        graph_errors_sample: [],
        normalized_post_id: postId,
        source_post_id: postId,
        extracted_permalink_object_id: extractPermalinkObjectId(safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || ""),
        reel_id_from_permalink: "",
        reel_thumbnail_present: false,
        object_id_thumbnail_present: false,
      });
    }
    const nextMetadata = {
      ...metadata,
      post_id: postId,
      post_type: graphPost.post_type || safeRow.post_type || metadata.post_type || "",
      media_type: graphPost.media_type || safeRow.media_type || metadata.media_type || "",
      graph_fields_present: asArray(graphPost.graph_fields_present || metadata.graph_fields_present || []),
      attachments_shape: metadataObject(graphPost.attachments_shape || metadata.attachments_shape || {}),
      full_picture_present: Boolean(graphPost.full_picture_present ?? safeRow.full_picture_present ?? metadata.full_picture_present),
      attachment_image_present: Boolean(graphPost.attachment_image_present ?? safeRow.attachment_image_present ?? metadata.attachment_image_present),
      picture: graphPost.picture || safeRow.picture || metadata.picture || "",
      source: graphPost.source || safeRow.source || metadata.source || "",
      child_attachments: asArray(graphPost.child_attachments || safeRow.child_attachments || metadata.child_attachments || []),
      post_full_picture: graphPost.full_picture || graphPost.post_full_picture || safeRow.post_full_picture || "",
      attachment_image: graphPost.attachment_image || safeRow.attachment_image || "",
      post_thumbnail: graphPost.post_thumbnail || safeRow.post_thumbnail || "",
      post_caption: graphPost.post_caption || graphPost.caption || safeRow.post_caption || "",
      post_message: graphPost.post_message || graphPost.message || safeRow.post_message || "",
      post_permalink_url: graphPost.permalink_url || safeRow.post_permalink_url || safeRow.permalink_url || "",
      attachments: asArray(graphPost.attachments || metadata.attachments || safeRow.attachments || []),
    };
    const mergedRow = {
      ...safeRow,
      post_full_picture: nextMetadata.post_full_picture,
      attachment_image: nextMetadata.attachment_image,
      post_thumbnail: nextMetadata.post_thumbnail || nextMetadata.post_full_picture || nextMetadata.attachment_image || "",
      post_caption: nextMetadata.post_caption,
      post_message: nextMetadata.post_message,
      post_permalink: nextMetadata.post_permalink_url,
      post_permalink_url: nextMetadata.post_permalink_url,
      permalink_url: nextMetadata.post_permalink_url || safeRow.permalink_url || "",
      full_picture: graphPost.full_picture || safeRow.full_picture || "",
      picture: graphPost.picture || safeRow.picture || "",
      source: graphPost.source || safeRow.source || "",
      attachments: asArray(graphPost.attachments || safeRow.attachments || []),
      child_attachments: asArray(graphPost.child_attachments || safeRow.child_attachments || []),
      metadata: nextMetadata,
    };
    const nextDetails = resolvePostThumbnailDetails(mergedRow);
    const nextPersistedMetadata = {
      ...nextMetadata,
      thumbnail_url: nextDetails.thumbnail_url,
      thumbnail_source: nextDetails.thumbnail_source,
      has_thumbnail: nextDetails.has_thumbnail,
      graph_enriched: true,
      fallback_enriched: false,
      reason_if_missing: nextDetails.reason_if_missing || "",
      media_enrichment_status: "graph_enriched",
    };
    await persistSocialCommentPostMedia({
      tenantId,
      channel: safeRow.channel || (normalizePlatform(platform) === "instagram" ? "instagram_comment" : "facebook_comment"),
      conversationId: safeRow.conversation_id || safeRow.external_conversation_id || "",
      metadata: nextPersistedMetadata,
    });
    if (shouldLogMediaBackfill) {
      console.warn("[social-comments:media-backfill:result]", {
        conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || ""),
        original_post_id: postId,
        resolved_graph_id: resolvedGraphId,
        graph_media_found: Boolean(nextDetails.thumbnail_url),
        media_source_used: nextDetails.thumbnail_source || "graph",
        thumbnail_url_saved: text(nextDetails.thumbnail_url || ""),
        error_message: text(graphErrorMessage || graphPost?.reason_if_missing || ""),
      });
    }
    return {
      ...mergedRow,
      metadata: nextPersistedMetadata,
      had_thumbnail_before: currentHasThumbnail,
      thumbnail_url: nextDetails.thumbnail_url,
      thumbnail_source: nextDetails.thumbnail_source,
      has_thumbnail: nextDetails.has_thumbnail,
      thumbnail_saved: Boolean(isUsableImageUrl(nextDetails.thumbnail_url)),
      post_type: nextMetadata.post_type,
      media_type: nextMetadata.media_type,
      graph_fields_present: nextMetadata.graph_fields_present,
      attachments_shape: nextMetadata.attachments_shape,
      full_picture_present: nextMetadata.full_picture_present,
      attachment_image_present: nextMetadata.attachment_image_present,
      graph_enriched: true,
      fallback_enriched: false,
      reason_if_missing: nextDetails.reason_if_missing || "",
      tried_ids: asArray(graphPost.tried_ids || []),
      tried_graph_ids: asArray(graphPost.tried_graph_ids || graphPost.tried_ids || []),
      skipped_non_graph_ids: asArray(graphPost.skipped_non_graph_ids || []),
      normalized_post_id: postId,
      source_post_id: postId,
      extracted_permalink_object_id: text(graphPost.extracted_permalink_object_id || ""),
      graph_errors_sample: asArray(graphPost.graph_errors_sample || []),
      reel_id_from_permalink: text(graphPost.reel_id_from_permalink || ""),
      reel_thumbnail_present: Boolean(graphPost.reel_thumbnail_present),
      object_id_thumbnail_present: Boolean(graphPost.object_id_thumbnail_present),
    };
  } catch (error) {
    if (shouldLogMediaBackfill) {
      console.warn("[social-comments:media-backfill:result]", {
        conversation_id: text(safeRow.conversation_id || safeRow.external_conversation_id || ""),
        original_post_id: postId,
        resolved_graph_id: resolvedGraphId || graphLookupFallbackPostIds[0] || graphPostId || "",
        graph_media_found: false,
        media_source_used: "graph_error",
        thumbnail_url_saved: "",
        error_message: text(error?.message || ""),
      });
    }
    return {
      ...safeRow,
      had_thumbnail_before: currentHasThumbnail,
      thumbnail_url: currentDetails.thumbnail_url,
      thumbnail_source: currentDetails.thumbnail_source,
      has_thumbnail: currentDetails.has_thumbnail,
      post_type: text(safeRow.post_type || metadata.post_type || ""),
      media_type: text(safeRow.media_type || metadata.media_type || ""),
      graph_fields_present: asArray(safeRow.graph_fields_present || metadata.graph_fields_present || []),
      attachments_shape: metadataObject(safeRow.attachments_shape || metadata.attachments_shape || {}),
      full_picture_present: Boolean(safeRow.full_picture_present ?? metadata.full_picture_present),
      attachment_image_present: Boolean(safeRow.attachment_image_present ?? metadata.attachment_image_present),
      graph_enriched: false,
      fallback_enriched: false,
      reason_if_missing: currentDetails.reason_if_missing || "graph_error",
      media_enrichment_status: text(metadata.media_enrichment_status || "graph_error"),
      tried_ids: [],
      tried_graph_ids: [],
      skipped_non_graph_ids: [],
      graph_errors_sample: [],
      normalized_post_id: postId,
      source_post_id: postId,
      extracted_permalink_object_id: extractPermalinkObjectId(safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || ""),
      reel_id_from_permalink: "",
      reel_thumbnail_present: false,
      object_id_thumbnail_present: false,
    };
  }
};

const getSocialAutoReplySettings = async ({ tenantId = null } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  if (!safeTenantId) return { ...SOCIAL_AUTO_REPLY_DEFAULTS };
  await ensureSocialCommentsCenterSchema();
  const result = await db.query(
    `
    SELECT *
    FROM social_auto_reply_settings
    WHERE tenant_id = $1::bigint
    LIMIT 1
    `,
    [safeTenantId]
  );
  const row = result.rows?.[0];
  if (!row) return { ...SOCIAL_AUTO_REPLY_DEFAULTS };
  return {
    generic_enabled: toBool(row.generic_enabled, SOCIAL_AUTO_REPLY_DEFAULTS.generic_enabled),
    generic_like_enabled: toBool(row.generic_like_enabled, SOCIAL_AUTO_REPLY_DEFAULTS.generic_like_enabled),
    generic_reply_enabled: toBool(row.generic_reply_enabled, SOCIAL_AUTO_REPLY_DEFAULTS.generic_reply_enabled),
    generic_template: text(row.generic_template || SOCIAL_AUTO_REPLY_DEFAULTS.generic_template),
    mode: SOCIAL_AUTO_REPLY_MODES.has(lower(row.mode)) ? lower(row.mode) : SOCIAL_AUTO_REPLY_DEFAULTS.mode,
  };
};

const saveSocialAutoReplySettings = async ({ tenantId = null, payload = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  if (!safeTenantId) return null;
  await ensureSocialCommentsCenterSchema();
  const current = await getSocialAutoReplySettings({ tenantId: safeTenantId });
  const merged = {
    generic_enabled: toBool(payload.generic_enabled, current.generic_enabled),
    generic_like_enabled: toBool(payload.generic_like_enabled, current.generic_like_enabled),
    generic_reply_enabled: toBool(payload.generic_reply_enabled, current.generic_reply_enabled),
    generic_template: text(payload.generic_template || current.generic_template),
    mode: SOCIAL_AUTO_REPLY_MODES.has(lower(payload.mode)) ? lower(payload.mode) : current.mode,
  };
  const result = await db.query(
    `
    INSERT INTO social_auto_reply_settings (
      tenant_id,
      generic_enabled,
      generic_like_enabled,
      generic_reply_enabled,
      generic_template,
      mode,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id) DO UPDATE SET
      generic_enabled = EXCLUDED.generic_enabled,
      generic_like_enabled = EXCLUDED.generic_like_enabled,
      generic_reply_enabled = EXCLUDED.generic_reply_enabled,
      generic_template = EXCLUDED.generic_template,
      mode = EXCLUDED.mode,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [safeTenantId, merged.generic_enabled, merged.generic_like_enabled, merged.generic_reply_enabled, merged.generic_template, merged.mode]
  );
  const row = result.rows?.[0] || null;
  if (row) {
    emitSocialReplyStatus(row);
    emitSocialCommentUpdated(row);
  }
  return row;
};

const getSocialPostAutoReplyTemplate = async ({ tenantId = null, platform = "facebook", postId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId || !safePostId) return null;
  await ensureSocialCommentsCenterSchema();
  const result = await db.query(
    `
    SELECT *
    FROM social_post_auto_reply_templates
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = $3::text
    LIMIT 1
    `,
    [safeTenantId, normalizePlatform(platform), safePostId]
  );
  return result.rows?.[0] || null;
};

const saveSocialPostAutoReplyTemplate = async ({ tenantId = null, platform = "facebook", postId = "", payload = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId || !safePostId) return null;
  await ensureSocialCommentsCenterSchema();
  const current = await getSocialPostAutoReplyTemplate({ tenantId: safeTenantId, platform, postId: safePostId });
  const merged = {
    enabled: toBool(payload.enabled, current?.enabled ?? false),
    like_enabled: toBool(payload.like_enabled, current?.like_enabled ?? true),
    reply_enabled: toBool(payload.reply_enabled, current?.reply_enabled ?? true),
    template: text(payload.template ?? current?.template ?? ""),
    mode: SOCIAL_AUTO_REPLY_MODES.has(lower(payload.mode)) ? lower(payload.mode) : lower(current?.mode || "manual_approval"),
  };
  const result = await db.query(
    `
    INSERT INTO social_post_auto_reply_templates (
      tenant_id,
      platform,
      post_id,
      enabled,
      like_enabled,
      reply_enabled,
      template,
      mode,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (tenant_id, platform, post_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      like_enabled = EXCLUDED.like_enabled,
      reply_enabled = EXCLUDED.reply_enabled,
      template = EXCLUDED.template,
      mode = EXCLUDED.mode,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [safeTenantId, normalizePlatform(platform), safePostId, merged.enabled, merged.like_enabled, merged.reply_enabled, merged.template, merged.mode]
  );
  return result.rows?.[0] || null;
};

const buildSocialCommentTemplateContext = ({ post = {}, comment = {}, settings = {}, template = {} } = {}) => {
  const product = post.product || {};
  const sizes = asArray(post.sizes || product.sizes || post.product_sizes || []).filter(Boolean).join(", ");
  const colors = asArray(post.colors || product.colors || post.product_colors || []).filter(Boolean).join(", ");
  return {
    customer_name: text(comment.commenter_name || comment.customer_name || "عميل"),
    product_name: text(product.name || post.product_name || post.title || ""),
    price: text(product.price || post.price || ""),
    sale_price: text(product.sale_price || post.sale_price || ""),
    sizes,
    colors,
    product_link: text(product.storefront_url || product.product_url || post.product_link || ""),
    post_link: text(post.post_permalink || post.post_permalink_url || post.permalink_url || post.post_url || ""),
    store_address: text(settings.store_address || post.store_address || ""),
    shipping_time: text(settings.shipping_time || post.shipping_time || ""),
    post_message: text(post.post_message || post.post_caption || ""),
    comment_text: text(comment.message_text || comment.original_comment_text || ""),
    template_name: text(template.name || ""),
  };
};

const firstText = (...values) => values.map((value) => text(value)).find(Boolean) || "";

const normalizeGraphPictureUrl = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return text(value);
  if (typeof value !== "object") return text(value);
  return firstText(
    value.data?.url,
    value.url,
    value.picture?.data?.url,
    value.picture?.url,
    value.profile_pic_url,
    value.profile_pic,
    value.source
  );
};

const hydrateSocialCommentTimelineIdentity = async ({ tenantId = null, row = {}, platform = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const metadata = metadataObject(row.metadata || {});
  const rawPayload = metadataObject(row.raw_payload || {});
  const rawValue = metadataObject(rawPayload.value || {});
  const commenterId = firstText(
    row.commenter_id,
    row.external_customer_id,
    row.profile_id,
    row.customer_profile_id,
    rawValue.from?.id,
    rawPayload.from?.id,
    rawValue.from?.user_id,
    rawPayload.from?.user_id,
    metadata.commenter_id
  );
  const currentName = firstText(
    row.customer_name,
    row.commenter_name,
    row.from?.name,
    rawValue.from?.name,
    rawPayload.from?.name,
    metadata.customer_name,
    metadata.commenter_name,
    metadata.from?.name
  );
  const currentAvatar = normalizeGraphPictureUrl(
    row.customer_avatar_url ||
    row.commenter_profile_picture_url ||
    row.from?.picture ||
    rawValue.from?.picture ||
    rawPayload.from?.picture ||
    metadata.customer_avatar_url ||
    metadata.commenter_profile_picture_url ||
    metadata.from?.picture ||
    ""
  );
  const hydrated = {
    customer_name: currentName,
    customer_avatar_url: currentAvatar,
    commenter_id: commenterId,
  };

  if (!safeTenantId) return hydrated;

  const profileId = Number(row.customer_profile_id || row.profile_id || metadata.customer_profile_id || metadata.profile_id || 0) || null;
  let profileRow = null;

  if (profileId) {
    const byId = await db.query(
      `
      SELECT id, display_name, customer_name, facebook_name, messenger_name, profile_pic_url, external_customer_id
      FROM ai_customer_profiles
      WHERE tenant_id = $1::bigint
        AND id = $2::bigint
      LIMIT 1
      `,
      [safeTenantId, profileId]
    ).catch(() => ({ rows: [] }));
    profileRow = byId.rows?.[0] || null;
  } else if (commenterId) {
    const byExternal = await db.query(
      `
      SELECT id, display_name, customer_name, facebook_name, messenger_name, profile_pic_url, external_customer_id
      FROM ai_customer_profiles
      WHERE tenant_id = $1::bigint
        AND external_customer_id = $2::text
      ORDER BY last_seen_at DESC, id DESC
      LIMIT 1
      `,
      [safeTenantId, commenterId]
    ).catch(() => ({ rows: [] }));
    profileRow = byExternal.rows?.[0] || null;

    if (!profileRow && row.session_id) {
      const conversationProfile = await db.query(
        `
        SELECT p.id, p.display_name, p.customer_name, p.facebook_name, p.messenger_name, p.profile_pic_url, p.external_customer_id
        FROM ai_channel_conversations c
        LEFT JOIN ai_customer_profiles p
          ON p.id = c.customer_profile_id
         AND p.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1::bigint
          AND c.external_conversation_id = $2::text
        LIMIT 1
        `,
        [safeTenantId, text(row.session_id || "")]
      ).catch(() => ({ rows: [] }));
      profileRow = conversationProfile.rows?.[0] || null;
    }
  }

  if (profileRow) {
    hydrated.customer_name = hydrated.customer_name || firstText(profileRow.display_name, profileRow.customer_name, profileRow.facebook_name, profileRow.messenger_name);
    hydrated.customer_avatar_url = hydrated.customer_avatar_url || firstText(profileRow.profile_pic_url);
  }

  return hydrated;
};

const normalizeSocialCommentTimelineRow = async ({ tenantId = null, row = {}, platform = "" } = {}) => {
  const metadata = metadataObject(row.metadata || {});
  const normalizedPlatform = normalizePlatform(platform || row.platform || metadata.platform || "facebook");
  const commenter = await hydrateSocialCommentTimelineIdentity({ tenantId, row, platform: normalizedPlatform });
  const commentText = firstText(
    row.customer_message,
    row.message_text,
    row.message,
    row.text,
    row.original_comment_text,
    metadata.customer_message,
    metadata.message_text,
    metadata.message,
    metadata.text
  );
  const createdAt = firstText(
    row.comment_created_time,
    row.created_time,
    row.createdTime,
    row.created_at,
    row.processed_at,
    metadata.comment_created_time,
    metadata.created_time,
    metadata.created_at,
    metadata.processed_at
  );
  const postId = firstText(
    row.post_id,
    row.conversation_post_id,
    row.thread_post_id,
    metadata.post_id,
    metadata.conversation_post_id,
    metadata.thread_post_id
  );
  const commentId = firstText(
    row.comment_id,
    row.id,
    row.external_message_id,
    row.provider_message_id,
    metadata.comment_id,
    metadata.external_message_id,
    metadata.provider_message_id
  );
  const fromName = firstText(
    row.from?.name,
    metadata.from?.name,
    row.customer_name,
    row.commenter_name,
    commenter.customer_name
  );
  const fromAvatar = normalizeGraphPictureUrl(
    row.from?.picture ||
    metadata.from?.picture ||
    row.customer_avatar_url ||
    row.commenter_profile_picture_url ||
    commenter.customer_avatar_url ||
    ""
  );
  return {
    ...row,
    customer_name: commenter.customer_name || fromName || "",
    commenter_name: commenter.customer_name || fromName || "",
    customer_avatar_url: commenter.customer_avatar_url || fromAvatar || "",
    commenter_profile_picture_url: commenter.customer_avatar_url || fromAvatar || "",
    comment_text: commentText,
    original_comment_text: firstText(row.original_comment_text, commentText),
    created_at: createdAt,
    created_time: createdAt,
    createdTime: createdAt,
    platform: normalizedPlatform,
    post_id: postId,
    comment_id: commentId,
    raw: {
      ...(row.raw && typeof row.raw === "object" && !Array.isArray(row.raw) ? row.raw : {}),
      from: {
        ...(row.raw?.from && typeof row.raw.from === "object" && !Array.isArray(row.raw.from) ? row.raw.from : {}),
        name: fromName || commenter.customer_name || "",
        picture: fromAvatar || commenter.customer_avatar_url || "",
      },
    },
    metadata: {
      ...metadata,
      customer_name: commenter.customer_name || fromName || "",
      commenter_name: commenter.customer_name || fromName || "",
      customer_avatar_url: commenter.customer_avatar_url || fromAvatar || "",
      commenter_profile_picture_url: commenter.customer_avatar_url || fromAvatar || "",
      comment_text: commentText,
      original_comment_text: firstText(row.original_comment_text, commentText),
      created_at: createdAt,
      created_time: createdAt,
      platform: normalizedPlatform,
      post_id: postId,
      comment_id: commentId,
    },
  };
};

const renderSocialCommentTemplateText = (templateText = "", context = {}) =>
  text(templateText).replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return text(context[key] ?? context[key.toLowerCase()] ?? "");
  });

const normalizeSocialCommentAutomationSettings = (value = {}) => ({
  enabled: Boolean(value.enabled),
  likeComment: value.likeComment ?? value.like_comment ?? true,
  publicReply: value.publicReply ?? value.public_reply ?? true,
  privateReply: value.privateReply ?? value.private_reply ?? true,
  aiFollowUp: value.aiFollowUp ?? value.ai_follow_up ?? true,
  createLead: value.createLead ?? value.create_lead ?? false,
});

const buildSocialCommentAutomationDefaultTemplates = (post = {}, product = {}) => {
  const productName = text(product.name || post.product_name || post.title || post.post_caption || post.post_message || "Linked product");
  const price = text(product.sale_price || product.price || post.product_sale_price || post.product_price || "");
  const sizes = text(post.product_sizes || post.sizes || product.sizes || "");
  const productLink = text(product.storefront_url || product.product_url || post.product_link || "");
  return {
    publicReplyTemplate: "تم الرد على حضرتك في الخاص ✅",
    privateReplyTemplate: `أهلاً {{customer_name}}
{{product_name}} متاح بسعر {{price}}.
المقاسات المتاحة: {{available_sizes}}
اطلبه مباشرة من هنا: {{product_link}}`,
    aiOpeningPrompt: "أنت مساعد مبيعات داخل AI Social Media Center. وجّه العميل لإكمال الشراء من خلال الموقع فقط واستخدم {{product_link}} و{{checkout_link}} عندما يكونان متاحين.",
  };
};

const normalizeSocialCommentAutomationConfigRow = (row = {}, defaults = {}) => ({
  id: row.id || null,
  tenant_id: Number(row.tenant_id || 0) || null,
  post_id: text(row.post_id || defaults.post_id || ""),
  platform: normalizePlatform(row.platform || defaults.platform || "facebook"),
  product_id: row.product_id ?? defaults.product_id ?? null,
  template_key: text(row.template_key || defaults.template_key || "product_comment_sales_flow") || "product_comment_sales_flow",
  enabled: Boolean(row.enabled ?? defaults.enabled ?? false),
  settings: normalizeSocialCommentAutomationSettings(row.settings || defaults.settings || {}),
  message_templates: {
    ...buildSocialCommentAutomationDefaultTemplates(defaults.post || {}, defaults.product || {}),
    ...(metadataObject(row.message_templates || {})),
  },
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
  persisted: Boolean(row.id),
});

const collectSocialCommentAutomationConfigCandidates = ({ postId = "", row = {}, post = {} } = {}) => {
  const candidates = [];
  const seen = new Set();
  const push = (key, value) => {
    const candidateValue = text(value);
    if (!candidateValue || seen.has(candidateValue)) return;
    seen.add(candidateValue);
    candidates.push({ key, value: candidateValue });
  };
  const safeRow = metadataObject(row);
  const safePost = metadataObject(post);
  const safeRowMetadata = metadataObject(safeRow.metadata || {});
  const safePostMetadata = metadataObject(safePost.metadata || {});
  push("post_id", postId || safeRow.post_id || safePost.post_id || safeRowMetadata.post_id || safePostMetadata.post_id || "");
  push("platform_post_id", safeRow.platform_post_id || safeRowMetadata.platform_post_id || safePost.platform_post_id || safePostMetadata.platform_post_id || safeRowMetadata.external_post_id || safePostMetadata.external_post_id || "");
  push("wrapper_post_id", safeRow.wrapper_post_id || safeRowMetadata.wrapper_post_id || safePost.wrapper_post_id || safePostMetadata.wrapper_post_id || "");
  push("internal_post_id", safeRow.internal_post_id || safeRowMetadata.internal_post_id || safePost.internal_post_id || safePostMetadata.internal_post_id || "");
  push("source_post_id", safeRow.source_post_id || safeRowMetadata.source_post_id || safePost.source_post_id || safePostMetadata.source_post_id || "");
  push("metadata.post_id", safeRowMetadata.post_id || safePostMetadata.post_id || "");
  push("metadata.platform_post_id", safeRowMetadata.platform_post_id || safePostMetadata.platform_post_id || "");
  push("metadata.external_post_id", safeRowMetadata.external_post_id || safePostMetadata.external_post_id || "");
  push("raw_payload.post_id", safeRow.raw_payload?.post_id || safePost.raw_payload?.post_id || "");
  push("raw_payload.platform_post_id", safeRow.raw_payload?.platform_post_id || safePost.raw_payload?.platform_post_id || "");
  push("raw_payload.value.post_id", safeRow.raw_payload?.value?.post_id || safePost.raw_payload?.value?.post_id || "");
  push("raw_payload.value.media_id", safeRow.raw_payload?.value?.media_id || safePost.raw_payload?.value?.media_id || "");
  push("raw_payload.value.post.id", safeRow.raw_payload?.value?.post?.id || safePost.raw_payload?.value?.post?.id || "");
  push("raw_payload.value.post.post_id", safeRow.raw_payload?.value?.post?.post_id || safePost.raw_payload?.value?.post?.post_id || "");
  push("conversation_id", safeRow.conversation_id || safePost.conversation_id || "");
  push("external_conversation_id", safeRow.external_conversation_id || safePost.external_conversation_id || "");
  push("metadata.conversation_id", safeRowMetadata.conversation_id || safePostMetadata.conversation_id || "");
  return candidates;
};

const migrateSocialCommentAutomationConfigPostId = async ({ tenantId = null, platform = "", canonicalPostId = "", row = {}, post = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeCanonicalPostId = text(canonicalPostId || row?.canonical_post_id || row?.post_id || post?.canonical_post_id || post?.post_id || "");
  if (!safeTenantId || !safeCanonicalPostId) return null;
  const candidateEntries = collectSocialCommentAutomationConfigCandidates({ postId: safeCanonicalPostId, row, post });
  const candidatePostIds = Array.from(new Set(candidateEntries.map((entry) => entry.value).filter(Boolean)));
  if (!candidatePostIds.length) return null;

  const existing = await db.query(
    `
    SELECT *
    FROM social_comment_post_automation_configs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    ORDER BY updated_at DESC, created_at DESC, id DESC
    `,
    [safeTenantId, normalizedPlatform, candidatePostIds]
  ).catch(() => ({ rows: [] }));
  const rows = existing.rows || [];
  if (!rows.length) return null;

  const canonicalRow = rows.find((item) => text(item.post_id) === safeCanonicalPostId) || null;
  if (canonicalRow) {
    const staleRows = rows.filter((item) => text(item.post_id) !== safeCanonicalPostId);
    if (staleRows.length) {
      await db.query(
        `
        DELETE FROM social_comment_post_automation_configs
        WHERE tenant_id = $1::bigint
          AND platform = $2::text
          AND post_id = ANY($3::text[])
          AND post_id <> $4::text
        `,
        [safeTenantId, normalizedPlatform, candidatePostIds, safeCanonicalPostId]
      ).catch(() => {});
    }
    return canonicalRow;
  }

  const rowToPromote = rows[0];
  if (!rowToPromote?.id) return null;
  await db.query(
    `
    UPDATE social_comment_post_automation_configs
    SET post_id = $4::text,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $3::bigint
      AND tenant_id = $1::bigint
      AND platform = $2::text
    `,
    [safeTenantId, normalizedPlatform, rowToPromote.id, safeCanonicalPostId]
  ).catch(() => {});
  const duplicateIds = rows.filter((item) => Number(item.id) !== Number(rowToPromote.id)).map((item) => Number(item.id)).filter(Boolean);
  if (duplicateIds.length) {
    await db.query(
      `
      DELETE FROM social_comment_post_automation_configs
      WHERE tenant_id = $1::bigint
        AND platform = $2::text
        AND id = ANY($3::bigint[])
      `,
      [safeTenantId, normalizedPlatform, duplicateIds]
    ).catch(() => {});
  }
  return { ...rowToPromote, post_id: safeCanonicalPostId };
};

const resolveSocialCommentAutomationDefaultConfig = async ({ tenantId = null, platform = "", postId = "", post = null, hydratePost = true } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  const normalizedPlatform = normalizePlatform(platform);
  const safePost = metadataObject(post || {});
  const resolvedPost = safePost && Object.keys(safePost).length ? safePost : hydratePost ? await loadSocialCommentPost({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }).catch(() => null) : null;
  const product = metadataObject(resolvedPost?.product || {});
  return {
    id: null,
    tenant_id: safeTenantId,
    post_id: safePostId,
    platform: normalizedPlatform,
    product_id: resolvedPost?.product_id || product?.id || null,
    template_key: "product_comment_sales_flow",
    enabled: false,
    settings: normalizeSocialCommentAutomationSettings({
      enabled: false,
      likeComment: true,
      publicReply: true,
      privateReply: true,
      aiFollowUp: true,
      createLead: false,
    }),
    message_templates: buildSocialCommentAutomationDefaultTemplates(resolvedPost || {}, product || {}),
    created_at: null,
    updated_at: null,
    persisted: false,
    source: "default",
    post: resolvedPost || {},
    product: product || {},
  };
};

export const getSocialCommentAutomationConfig = async ({ tenantId = null, platform = "", postId = "", row = {}, post = {}, hydratePost = true } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId && !metadataObject(row)?.tenant_id) return null;
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const canonicalPostId = text(
    post?.canonical_post_id ||
    row?.canonical_post_id ||
    resolveSocialCommentCanonicalPostId(post || row || {}) ||
    safePostId
  );
  if (canonicalPostId) {
    await migrateSocialCommentAutomationConfigPostId({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      canonicalPostId,
      row,
      post,
    }).catch(() => {});
  }
  const candidateEntries = collectSocialCommentAutomationConfigCandidates({ postId: safePostId, row, post });
  const candidatePostIds = Array.from(new Set(candidateEntries.map((entry) => entry.value).filter(Boolean)));
  console.log("CONFIG_LOOKUP_INPUT", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    incoming_post_id: safePostId,
    incoming_platform_post_id: text(row?.platform_post_id || post?.platform_post_id || row?.metadata?.platform_post_id || post?.metadata?.platform_post_id || row?.raw_payload?.platform_post_id || post?.raw_payload?.platform_post_id || ""),
    incoming_wrapper_post_id: text(row?.wrapper_post_id || post?.wrapper_post_id || row?.metadata?.wrapper_post_id || post?.metadata?.wrapper_post_id || ""),
    incoming_internal_post_id: text(row?.internal_post_id || post?.internal_post_id || row?.metadata?.internal_post_id || post?.metadata?.internal_post_id || ""),
    candidate_keys: candidateEntries.map((entry) => ({ key: entry.key, value: entry.value })),
  });
  if (!candidatePostIds.length) {
    const fallbackConfig = await resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId, post, hydratePost });
    console.log("CONFIG_LOOKUP_RESULT", {
      matched_key: "",
      config_id: fallbackConfig?.id || null,
      enabled: Boolean(fallbackConfig?.enabled),
      template_key: text(fallbackConfig?.template_key || ""),
    });
    return fallbackConfig;
  }
  const result = await db.query(
    `
    SELECT *
    FROM social_comment_post_automation_configs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND post_id = ANY($3::text[])
    ORDER BY updated_at DESC, created_at DESC, id DESC
    `,
    [safeTenantId, normalizedPlatform, candidatePostIds]
  );
  const configRow = result.rows?.[0] || null;
  if (configRow) {
    const defaults = await resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId, post, hydratePost });
    const matchedEntry = candidateEntries.find((entry) => text(configRow.post_id) === entry.value) || null;
    const normalizedConfig = {
      ...normalizeSocialCommentAutomationConfigRow(configRow, defaults),
      lookup_matched_key: matchedEntry?.key || "post_id",
      lookup_matched_post_id: matchedEntry?.value || text(configRow.post_id || safePostId),
      lookup_candidate_post_ids: candidateEntries.map((entry) => ({ key: entry.key, value: entry.value })),
      lookup_source: matchedEntry?.key && matchedEntry.key !== "post_id" ? "variant" : "exact",
    };
    console.log("CONFIG_LOOKUP_RESULT", {
      matched_key: normalizedConfig.lookup_matched_key || "post_id",
      config_id: normalizedConfig.id || null,
      enabled: Boolean(normalizedConfig.enabled),
      template_key: text(normalizedConfig.template_key || ""),
    });
    return normalizedConfig;
  }
  const fallbackConfig = {
    ...(await resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId, post, hydratePost })),
    lookup_matched_key: "",
    lookup_matched_post_id: "",
    lookup_candidate_post_ids: candidateEntries.map((entry) => ({ key: entry.key, value: entry.value })),
    lookup_source: "default",
  };
  console.log("CONFIG_LOOKUP_RESULT", {
    matched_key: "",
    config_id: fallbackConfig?.id || null,
    enabled: Boolean(fallbackConfig?.enabled),
    template_key: text(fallbackConfig?.template_key || ""),
  });
  return fallbackConfig;
};

export const upsertSocialCommentAutomationConfig = async ({ tenantId = null, platform = "", postId = "", payload = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId || !safePostId) {
    throw Object.assign(new Error("Invalid tenant or post id"), { status: 400 });
  }
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const defaults = await resolveSocialCommentAutomationDefaultConfig({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId });
  const canonicalPostId = text(payload.canonical_post_id || payload.canonicalPostId || payload.selected_post_id || payload.selectedPostId || safePostId);
  if (canonicalPostId) {
    await migrateSocialCommentAutomationConfigPostId({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      canonicalPostId,
      row: payload,
      post: payload,
    }).catch(() => {});
  }
  const rawSettings = metadataObject(payload.settings || {});
  const rawTemplates = metadataObject(payload.message_templates || {});
  const mergedSettings = normalizeSocialCommentAutomationSettings({
    ...defaults.settings,
    ...rawSettings,
    enabled: Object.prototype.hasOwnProperty.call(payload, "enabled") ? Boolean(payload.enabled) : defaults.enabled,
  });
  const templateKey = text(payload.template_key || payload.templateKey || defaults.template_key || "product_comment_sales_flow") || "product_comment_sales_flow";
  const numericProductId = Number(payload.product_id ?? payload.productId ?? defaults.product_id ?? null);
  const productId = Number.isFinite(numericProductId) && numericProductId > 0 ? Math.trunc(numericProductId) : null;
  const messageTemplates = {
    ...buildSocialCommentAutomationDefaultTemplates(defaults, defaults.product || {}),
    ...defaults.message_templates,
    ...rawTemplates,
  };
  if (Object.prototype.hasOwnProperty.call(rawTemplates, "publicReplyTemplate")) {
    messageTemplates.publicReplyTemplate = text(rawTemplates.publicReplyTemplate);
  }
  if (Object.prototype.hasOwnProperty.call(rawTemplates, "privateReplyTemplate")) {
    messageTemplates.privateReplyTemplate = text(rawTemplates.privateReplyTemplate);
  }
  if (Object.prototype.hasOwnProperty.call(rawTemplates, "aiOpeningPrompt")) {
    messageTemplates.aiOpeningPrompt = text(rawTemplates.aiOpeningPrompt);
  }

  const result = await db.query(
    `
    INSERT INTO social_comment_post_automation_configs (
      tenant_id,
      post_id,
      platform,
      product_id,
      template_key,
      enabled,
      settings,
      message_templates,
      created_at,
      updated_at
    )
    VALUES (
      $1::bigint,
      $2::text,
      $3::text,
      $4::bigint,
      $5::text,
      $6::boolean,
      $7::jsonb,
      $8::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, post_id, platform) DO UPDATE SET
      product_id = EXCLUDED.product_id,
      template_key = EXCLUDED.template_key,
      enabled = EXCLUDED.enabled,
      settings = EXCLUDED.settings,
      message_templates = EXCLUDED.message_templates,
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      safeTenantId,
      canonicalPostId || safePostId,
      normalizedPlatform,
      productId,
      templateKey,
      Boolean(payload.enabled ?? defaults.enabled),
      JSON.stringify(mergedSettings),
      JSON.stringify(messageTemplates),
    ]
  );
  const row = result.rows?.[0] || null;
  return row ? normalizeSocialCommentAutomationConfigRow(row, { postId: canonicalPostId || safePostId, platform: normalizedPlatform, product_id: productId, settings: mergedSettings, message_templates: messageTemplates }) : null;
};

export const loadSocialCommentPost = async ({ tenantId = null, platform = "", postId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId || !safePostId) return null;
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const result = await db.query(
    `
    SELECT
      c.tenant_id,
      c.channel,
      CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END AS platform,
      c.thread_kind,
      c.external_conversation_id AS conversation_id,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      c.last_message,
      c.last_message_at,
      c.read_at AS conversation_read_at,
      COALESCE(c.metadata->>'post_full_picture', c.metadata->>'full_picture', '') AS post_full_picture,
      COALESCE(c.metadata->>'attachment_image', '') AS attachment_image,
      COALESCE(c.metadata->>'post_thumbnail', c.metadata->>'thumbnail_url', '') AS post_thumbnail,
      COALESCE(c.metadata->>'post_caption', c.metadata->>'post_message', c.metadata->>'caption', '') AS post_caption,
      COALESCE(c.metadata->>'post_message', c.metadata->>'message', '') AS post_message,
      COALESCE(c.metadata->>'post_permalink_url', c.metadata->>'post_permalink', c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS post_permalink_url,
      COALESCE(c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS permalink_url,
      COALESCE(c.metadata->>'thumbnail_url', '') AS thumbnail_url,
      c.metadata,
      runmeta.automation_run_post_id,
      runmeta.automation_run_raw_payload,
      s.read_at AS session_read_at,
      s.status AS session_status,
      s.updated_at AS session_updated_at,
      agg.comments_count,
      agg.new_comments_count,
      agg.last_comment_text,
      agg.last_comment_at,
      agg.last_commenter_name,
      agg.last_commenter_id,
      agg.last_comment_id,
      prod.product_id,
      prod.product_name,
      prod.product_price,
      prod.product_sale_price,
      prod.product_image_url,
      prod.product_gallery_images,
      prod.product_variant_images,
      prod.product_storefront_url,
      prod.product_sizes,
      prod.product_colors,
      reply.like_status,
      reply.reply_status,
      reply.auto_reply_mode,
      COALESCE(tmpl.enabled, settings.generic_enabled, FALSE) AS auto_reply_enabled,
      COALESCE(tmpl.enabled, FALSE) AS template_enabled,
      COALESCE(settings.generic_enabled, FALSE) AS generic_enabled
    FROM ai_channel_conversations c
    LEFT JOIN ai_support_sessions s
      ON s.tenant_id = c.tenant_id
     AND s.session_id = c.external_conversation_id
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(r.post_id ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_post_id,
        (ARRAY_AGG(r.raw_payload ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_raw_payload
      FROM social_comment_automation_runs r
      WHERE r.tenant_id = c.tenant_id
        AND r.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND r.inbox_conversation_id = c.external_conversation_id
    ) runmeta ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS comments_count,
        COUNT(*) FILTER (WHERE msg.created_at > COALESCE(c.read_at, s.read_at))::int AS new_comments_count,
        MAX(NULLIF(msg.comment_created_time, '')) AS real_comment_created_time,
        MAX(msg.created_at) AS last_comment_at,
        MAX(msg.created_at) AS msg_created_at,
        (ARRAY_AGG(msg.customer_message ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_comment_text,
        (ARRAY_AGG(msg.customer_name ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_commenter_name,
        (ARRAY_AGG(msg.commenter_id ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_commenter_id,
        (ARRAY_AGG(msg.comment_id ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_comment_id
      FROM ai_support_messages msg
      WHERE msg.tenant_id = c.tenant_id
        AND msg.session_id = c.external_conversation_id
        AND msg.message_type = 'comment_inbound'
    ) agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(run.like_status ORDER BY run.created_at DESC, run.id DESC))[1] AS like_status,
        (ARRAY_AGG(run.reply_status ORDER BY run.created_at DESC, run.id DESC))[1] AS reply_status,
        (ARRAY_AGG(run.mode ORDER BY run.created_at DESC, run.id DESC))[1] AS auto_reply_mode
      FROM social_comment_auto_reply_runs run
      WHERE run.tenant_id = c.tenant_id
        AND run.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND run.post_id = c.metadata->>'post_id'
    ) reply ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        ppl.product_id,
        p.name AS product_name,
        p.price AS product_price,
        p.sale_price AS product_sale_price,
        p.image_url AS product_image_url,
        p.gallery_images AS product_gallery_images,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', vi.id,
              'image_url', vi.image_url,
              'color_name', vi.color_name,
              'color_value', vi.color_value,
              'sort_order', vi.sort_order,
              'is_primary', vi.is_primary
            )
            ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
          )
          FROM product_variant_images vi
          WHERE vi.product_id = ppl.product_id
            AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
        ), '[]'::jsonb) AS product_variant_images,
        COALESCE(ppl.media_id, '') AS product_storefront_url,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_sizes,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_colors
      FROM marketing_post_product_links ppl
      LEFT JOIN products p ON p.id = ppl.product_id
      WHERE ppl.business_id = c.tenant_id
        AND ppl.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND ppl.post_id = c.metadata->>'post_id'
      ORDER BY ppl.created_at DESC, ppl.id DESC
      LIMIT 1
    ) prod ON TRUE
    LEFT JOIN social_post_auto_reply_templates tmpl
      ON tmpl.tenant_id = c.tenant_id
     AND tmpl.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
     AND tmpl.post_id = c.metadata->>'post_id'
    LEFT JOIN social_auto_reply_settings settings
      ON settings.tenant_id = c.tenant_id
    WHERE c.tenant_id = $1::bigint
      AND c.metadata->>'post_id' = $2::text
      AND c.channel = $3::text
    LIMIT 1
    `,
    [safeTenantId, safePostId, normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"]
  );
  const row = result.rows?.[0] || null;
  if (!row) return null;
  const enriched = await enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform });
  const canonicalPostId = resolveSocialCommentCanonicalPostId(enriched || row) || text(enriched?.post_id || row.post_id || row.conversation_id || row.external_conversation_id || "");
  return {
    ...(enriched || {}),
    canonical_post_id: canonicalPostId,
    selected_post_id: text(postId),
  };
};

const listSocialCommentPosts = async ({ tenantId = null, platform = "", limit = 50 } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  if (!safeTenantId) return [];
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = lower(platform);
  const platformClause = normalizedPlatform === "facebook" || normalizedPlatform === "instagram"
    ? `AND c.channel = '${normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"}'`
    : "";
  const postsSql = `
    SELECT
      c.tenant_id,
      c.channel,
      CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END AS platform,
      c.thread_kind,
      c.external_conversation_id AS conversation_id,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      c.last_message,
      c.last_message_at,
      c.read_at AS conversation_read_at,
      COALESCE(c.metadata->>'post_full_picture', c.metadata->>'full_picture', '') AS post_full_picture,
      COALESCE(c.metadata->>'attachment_image', '') AS attachment_image,
      COALESCE(c.metadata->>'post_thumbnail', c.metadata->>'thumbnail_url', '') AS post_thumbnail,
      COALESCE(c.metadata->>'post_caption', c.metadata->>'post_message', c.metadata->>'caption', '') AS post_caption,
      COALESCE(c.metadata->>'post_message', c.metadata->>'message', '') AS post_message,
      COALESCE(c.metadata->>'post_permalink_url', c.metadata->>'post_permalink', c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS post_permalink_url,
      COALESCE(c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS permalink_url,
      COALESCE(c.metadata->>'thumbnail_url', '') AS thumbnail_url,
      c.metadata,
      runmeta.automation_run_post_id,
      runmeta.automation_run_raw_payload,
      s.read_at AS session_read_at,
      s.status AS session_status,
      s.updated_at AS session_updated_at,
      agg.comments_count,
      agg.new_comments_count,
      agg.last_comment_text,
      agg.last_comment_at,
      agg.last_commenter_name,
      agg.last_commenter_id,
      agg.last_comment_id,
      prod.product_id,
      prod.product_name,
      prod.product_price,
      prod.product_sale_price,
      prod.product_image_url,
      prod.product_gallery_images,
      prod.product_variant_images,
      prod.product_storefront_url,
      prod.product_sizes,
      prod.product_colors,
      reply.like_status,
      reply.reply_status,
      reply.auto_reply_mode,
      COALESCE(tmpl.enabled, settings.generic_enabled, FALSE) AS auto_reply_enabled,
      COALESCE(tmpl.enabled, FALSE) AS template_enabled,
      COALESCE(settings.generic_enabled, FALSE) AS generic_enabled
    FROM ai_channel_conversations c
    LEFT JOIN ai_support_sessions s
      ON s.tenant_id = c.tenant_id
     AND s.session_id = c.external_conversation_id
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(r.post_id ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_post_id,
        (ARRAY_AGG(r.raw_payload ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_raw_payload
      FROM social_comment_automation_runs r
      WHERE r.tenant_id = c.tenant_id
        AND r.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND r.inbox_conversation_id = c.external_conversation_id
    ) runmeta ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS comments_count,
        COUNT(*) FILTER (WHERE msg.created_at > COALESCE(c.read_at, s.read_at))::int AS new_comments_count,
        MAX(NULLIF(msg.comment_created_time, '')) AS real_comment_created_time,
        MAX(NULLIF(msg.comment_created_time, '')) AS last_comment_at,
        MAX(msg.created_at) AS msg_created_at,
        (ARRAY_AGG(msg.customer_message ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_comment_text,
        (ARRAY_AGG(msg.customer_name ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_commenter_name,
        (ARRAY_AGG(msg.commenter_id ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_commenter_id,
        (ARRAY_AGG(msg.comment_id ORDER BY NULLIF(msg.comment_created_time, '') DESC NULLS LAST, msg.id DESC))[1] AS last_comment_id
      FROM ai_support_messages msg
      WHERE msg.tenant_id = c.tenant_id
        AND msg.session_id = c.external_conversation_id
        AND msg.message_type = 'comment_inbound'
    ) agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(run.like_status ORDER BY run.created_at DESC, run.id DESC))[1] AS like_status,
        (ARRAY_AGG(run.reply_status ORDER BY run.created_at DESC, run.id DESC))[1] AS reply_status,
        (ARRAY_AGG(run.mode ORDER BY run.created_at DESC, run.id DESC))[1] AS auto_reply_mode
      FROM social_comment_auto_reply_runs run
      WHERE run.tenant_id = c.tenant_id
        AND run.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND run.post_id = c.metadata->>'post_id'
    ) reply ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        ppl.product_id,
        p.name AS product_name,
        p.price AS product_price,
        p.sale_price AS product_sale_price,
        p.image_url AS product_image_url,
        p.gallery_images AS product_gallery_images,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', vi.id,
              'image_url', vi.image_url,
              'color_name', vi.color_name,
              'color_value', vi.color_value,
              'sort_order', vi.sort_order,
              'is_primary', vi.is_primary
            )
            ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
          )
          FROM product_variant_images vi
          WHERE vi.product_id = ppl.product_id
            AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
        ), '[]'::jsonb) AS product_variant_images,
        COALESCE(ppl.media_id, '') AS product_storefront_url,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_sizes,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_colors
      FROM marketing_post_product_links ppl
      LEFT JOIN products p ON p.id = ppl.product_id
      WHERE ppl.business_id = c.tenant_id
        AND ppl.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND ppl.post_id = c.metadata->>'post_id'
      ORDER BY ppl.created_at DESC, ppl.id DESC
      LIMIT 1
    ) prod ON TRUE
    LEFT JOIN social_post_auto_reply_templates tmpl
      ON tmpl.tenant_id = c.tenant_id
     AND tmpl.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
     AND tmpl.post_id = c.metadata->>'post_id'
    LEFT JOIN social_auto_reply_settings settings
      ON settings.tenant_id = c.tenant_id
    WHERE c.tenant_id = $1::bigint
      AND c.thread_kind = 'comment'
      ${platformClause}
    ORDER BY COALESCE(agg.last_comment_at, c.last_message_at, c.updated_at) DESC, c.updated_at DESC
    LIMIT $2
    `;
  console.log("SOCIAL_COMMENTS_POSTS_SQL", {
    tenant_id: safeTenantId,
    platform: normalizedPlatform,
    limit: safeLimit,
    sql: postsSql,
  });
  const result = await db.query(
    postsSql,
    [safeTenantId, safeLimit]
  );
  const groupedPosts = new Map();
  const sourceRows = result.rows || [];
  for (const row of sourceRows) {
    const canonicalPostId = resolveSocialCommentCanonicalPostId(row) || text(row.metadata?.post_id || row.post_id || row.conversation_id || row.external_conversation_id || "");
    const key = canonicalPostId || text(row.conversation_id || row.external_conversation_id || row.post_id || "");
    if (!groupedPosts.has(key)) {
      groupedPosts.set(key, []);
    }
    groupedPosts.get(key).push(row);
  }
  const groupedSummaries = Array.from(groupedPosts.entries()).map(([key, rows]) => ({
    key,
    size: rows.length,
    sources: Array.from(new Set(rows.flatMap((row) => [
      text(row.metadata?.post_id || ""),
      text(row.automation_run_post_id || ""),
      text(row.post_id || ""),
      text(row.conversation_id || ""),
      text(row.external_conversation_id || ""),
    ]).filter(Boolean))),
  }));
  const groupedRows = groupedSummaries.map(({ key, size }) => {
    const rows = groupedPosts.get(key) || [];
    const sortedRows = [...rows].sort((a, b) => {
      const aTime = new Date(a.last_comment_at || a.last_message_at || a.updated_at || a.created_at || 0).getTime();
      const bTime = new Date(b.last_comment_at || b.last_message_at || b.updated_at || b.created_at || 0).getTime();
      return bTime - aTime;
    });
    const primary = sortedRows[0] || rows[0] || {};
    const commentsCount = rows.reduce((max, row) => Math.max(max, Number(row.comments_count || 0)), 0);
    const newCommentsCount = rows.reduce((max, row) => Math.max(max, Number(row.new_comments_count || 0)), 0);
    const latestActivity = sortedRows.reduce((latest, row) => {
      const rowTime = row.last_comment_at || row.last_message_at || row.updated_at || row.created_at || null;
      if (!latest) return rowTime;
      if (!rowTime) return latest;
      return new Date(rowTime).getTime() > new Date(latest).getTime() ? rowTime : latest;
    }, primary.last_comment_at || primary.last_message_at || primary.updated_at || primary.created_at || null);
    return {
      ...primary,
      id: key,
      canonical_post_id: key,
      post_id: key || text(primary.post_id || ""),
      conversation_id: key || text(primary.conversation_id || primary.external_conversation_id || ""),
      comment_created_time: primary.real_comment_created_time || primary.comment_created_time || null,
      real_comment_created_time: primary.real_comment_created_time || primary.comment_created_time || null,
      comments_count: commentsCount,
      new_comments_count: newCommentsCount,
      last_comment_at: latestActivity || primary.last_comment_at || primary.last_message_at || primary.updated_at || primary.created_at || null,
      last_message_at: latestActivity || primary.last_message_at || primary.last_comment_at || primary.updated_at || primary.created_at || null,
      last_activity_at: latestActivity || primary.last_comment_at || primary.last_message_at || primary.updated_at || primary.created_at || null,
      grouped_conversation_ids: rows.map((row) => text(row.conversation_id || row.external_conversation_id || "")).filter(Boolean),
      grouped_row_count: rows.length,
      latest_activity_at: latestActivity || primary.last_comment_at || primary.last_message_at || primary.updated_at || primary.created_at || null,
    };
  }).sort((a, b) => {
    const aTime = new Date(a.last_comment_at || a.last_message_at || a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.last_comment_at || b.last_message_at || b.updated_at || b.created_at || 0).getTime();
    return bTime - aTime;
  });
  debugSocialCommentsWarn("[social-comments:post-grouping-debug]", {
    raw_rows: sourceRows.length,
    grouped_posts: groupedRows.length,
    duplicate_groups_count: groupedSummaries.filter((group) => group.size > 1).length,
    sample_group_sizes: groupedSummaries.slice(0, 10).map((group) => ({ key: group.key, size: group.size })),
    sample_keys_with_sources: groupedSummaries.slice(0, 10).map((group) => ({ key: group.key, sources: group.sources.slice(0, 5) })),
  });
  return Promise.all(groupedRows.map((row) => enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform })));
};

const backfillSocialCommentPostMedia = async ({ tenantId = null, platform = "", limit = 200 } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200));
  if (!safeTenantId) {
    return {
      scanned: 0,
      enriched: 0,
      already_had_image: 0,
      still_missing: 0,
      missing_sample: [],
      errors_sample: [],
    };
  }
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = lower(platform);
  const platformClause = normalizedPlatform === "facebook" || normalizedPlatform === "instagram"
    ? `AND c.channel = '${normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"}'`
    : "";
  const result = await db.query(
    `
    SELECT
      c.tenant_id,
      c.channel,
      CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END AS platform,
      c.thread_kind,
      c.external_conversation_id AS conversation_id,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      c.last_message,
      c.last_message_at,
      c.read_at AS conversation_read_at,
      COALESCE(c.metadata->>'post_full_picture', c.metadata->>'full_picture', '') AS post_full_picture,
      COALESCE(c.metadata->>'attachment_image', '') AS attachment_image,
      COALESCE(c.metadata->>'post_thumbnail', c.metadata->>'thumbnail_url', '') AS post_thumbnail,
      COALESCE(c.metadata->>'post_caption', c.metadata->>'post_message', c.metadata->>'caption', '') AS post_caption,
      COALESCE(c.metadata->>'post_message', c.metadata->>'message', '') AS post_message,
      COALESCE(c.metadata->>'post_permalink_url', c.metadata->>'post_permalink', c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS post_permalink_url,
      COALESCE(c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS permalink_url,
      COALESCE(c.metadata->>'thumbnail_url', '') AS thumbnail_url,
      c.metadata,
      runmeta.automation_run_post_id,
      runmeta.automation_run_raw_payload,
      prod.product_id,
      prod.product_name,
      prod.product_price,
      prod.product_sale_price,
      prod.product_image_url,
      prod.product_gallery_images,
      prod.product_variant_images,
      prod.product_storefront_url,
      prod.product_sizes,
      prod.product_colors
    FROM ai_channel_conversations c
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(r.post_id ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_post_id,
        (ARRAY_AGG(r.raw_payload ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_raw_payload
      FROM social_comment_automation_runs r
      WHERE r.tenant_id = c.tenant_id
        AND r.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND r.inbox_conversation_id = c.external_conversation_id
    ) runmeta ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        ppl.product_id,
        p.name AS product_name,
        p.price AS product_price,
        p.sale_price AS product_sale_price,
        p.image_url AS product_image_url,
        p.gallery_images AS product_gallery_images,
        COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', vi.id,
              'image_url', vi.image_url,
              'color_name', vi.color_name,
              'color_value', vi.color_value,
              'sort_order', vi.sort_order,
              'is_primary', vi.is_primary
            )
            ORDER BY vi.is_primary DESC, vi.sort_order ASC, vi.id ASC
          )
          FROM product_variant_images vi
          WHERE vi.product_id = ppl.product_id
            AND NULLIF(TRIM(vi.image_url), '') IS NOT NULL
        ), '[]'::jsonb) AS product_variant_images,
        COALESCE(ppl.media_id, '') AS product_storefront_url,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.size, ''), ', ' ORDER BY NULLIF(v.size, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_sizes,
        COALESCE(
          (SELECT string_agg(DISTINCT NULLIF(v.color, ''), ', ' ORDER BY NULLIF(v.color, ''))
           FROM product_variants v
           WHERE v.tenant_id = c.tenant_id AND v.product_id = ppl.product_id),
          ''
        ) AS product_colors
      FROM marketing_post_product_links ppl
      LEFT JOIN products p ON p.id = ppl.product_id
      WHERE ppl.business_id = c.tenant_id
        AND ppl.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND ppl.post_id = c.metadata->>'post_id'
      ORDER BY ppl.created_at DESC, ppl.id DESC
      LIMIT 1
    ) prod ON TRUE
    WHERE c.tenant_id = $1::bigint
      AND c.thread_kind = 'comment'
      ${platformClause}
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT $2
    `,
    [safeTenantId, safeLimit]
  );

  const errorsSample = [];
  const missingSample = [];
  const missingSamplePostIds = new Set();
  let enriched = 0;
  let alreadyHadImage = 0;
  let stillMissing = 0;
  const rows = result.rows || [];
  const pushMissingSample = (sourceRow = {}, resolved = null, reason = "") => {
    const normalizedPostId = text(resolved?.normalized_post_id || resolved?.post_id || sourceRow.post_id || sourceRow.metadata?.post_id || sourceRow.conversation_id || "");
    const sourcePostId = text(sourceRow.post_id || sourceRow.metadata?.post_id || sourceRow.conversation_id || "");
    const dedupeKey = normalizedPostId || sourcePostId;
    if (!dedupeKey || missingSamplePostIds.has(dedupeKey) || missingSample.length >= 5) return;
    missingSamplePostIds.add(dedupeKey);
    missingSample.push({
      normalized_post_id: normalizedPostId,
      source_post_id: sourcePostId,
      permalink_url: text(
        resolved?.post_permalink_url ||
          resolved?.post_permalink ||
          resolved?.permalink_url ||
          sourceRow.post_permalink_url ||
          sourceRow.post_permalink ||
          sourceRow.permalink_url ||
          sourceRow.metadata?.post_permalink_url ||
          sourceRow.metadata?.post_permalink ||
          sourceRow.metadata?.permalink_url ||
          ""
      ),
      tried_graph_ids: asArray(resolved?.tried_graph_ids || sourceRow.tried_graph_ids || sourceRow.metadata?.tried_graph_ids || []),
      skipped_non_graph_ids: asArray(resolved?.skipped_non_graph_ids || sourceRow.skipped_non_graph_ids || sourceRow.metadata?.skipped_non_graph_ids || []),
      graph_errors_sample: asArray(resolved?.graph_errors_sample || sourceRow.graph_errors_sample || sourceRow.metadata?.graph_errors_sample || []),
      reel_id_from_permalink: text(resolved?.reel_id_from_permalink || sourceRow.reel_id_from_permalink || sourceRow.metadata?.reel_id_from_permalink || ""),
      extracted_permalink_object_id: text(resolved?.extracted_permalink_object_id || sourceRow.extracted_permalink_object_id || sourceRow.metadata?.extracted_permalink_object_id || ""),
      media_enrichment_status: text(resolved?.media_enrichment_status || sourceRow.media_enrichment_status || sourceRow.metadata?.media_enrichment_status || ""),
      reel_thumbnail_present: Boolean(resolved?.reel_thumbnail_present ?? sourceRow.reel_thumbnail_present ?? sourceRow.metadata?.reel_thumbnail_present),
      object_id_thumbnail_present: Boolean(resolved?.object_id_thumbnail_present ?? sourceRow.object_id_thumbnail_present ?? sourceRow.metadata?.object_id_thumbnail_present),
      post_type: text(resolved?.post_type || sourceRow.post_type || sourceRow.metadata?.post_type || ""),
      graph_fields_present: asArray(resolved?.graph_fields_present || sourceRow.graph_fields_present || sourceRow.metadata?.graph_fields_present || []),
      attachments_shape: metadataObject(resolved?.attachments_shape || sourceRow.attachments_shape || sourceRow.metadata?.attachments_shape || {}),
      media_type: text(resolved?.media_type || sourceRow.media_type || sourceRow.metadata?.media_type || ""),
      full_picture_present: Boolean(resolved?.full_picture_present ?? sourceRow.full_picture_present ?? sourceRow.metadata?.full_picture_present),
      attachment_image_present: Boolean(resolved?.attachment_image_present ?? sourceRow.attachment_image_present ?? sourceRow.metadata?.attachment_image_present),
      thumbnail_url: resolved?.thumbnail_url || sourceRow.thumbnail_url || sourceRow.metadata?.thumbnail_url || null,
      thumbnail_source: text(resolved?.thumbnail_source || sourceRow.thumbnail_source || sourceRow.metadata?.thumbnail_source || "missing"),
      reason_if_missing: text(reason || resolved?.reason_if_missing || sourceRow.reason_if_missing || sourceRow.metadata?.reason_if_missing || ""),
    });
  };
  for (const row of rows) {
    try {
      const resolved = await enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform });
      const savedThumbnail = isUsableImageUrl(resolved?.thumbnail_url);
      const hadThumbnailBefore = Boolean(resolved?.had_thumbnail_before);
      if (savedThumbnail && !hadThumbnailBefore) {
        enriched += 1;
      } else if (hadThumbnailBefore) {
        alreadyHadImage += 1;
      }
      if (!savedThumbnail) {
        stillMissing += 1;
        pushMissingSample(row, resolved);
      }
    } catch (error) {
      stillMissing += 1;
      pushMissingSample(row, null, error?.message || "enrich_error");
      if (errorsSample.length < 5) {
        errorsSample.push({
          conversation_id: text(row.conversation_id || ""),
          post_id: text(row.post_id || row.metadata?.post_id || ""),
          message: text(error?.message || "Unknown error"),
          code: text(error?.code || ""),
          detail: text(error?.detail || error?.stack || ""),
        });
      }
    }
  }

  return {
    scanned: rows.length,
    attempted: rows.length,
    enriched,
    already_had_image: alreadyHadImage,
    still_missing: stillMissing,
    missing_sample: missingSample,
    errors_sample: errorsSample,
  };
};

const listSocialCommentThreadComments = async ({ tenantId = null, platform = "", postId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safePostId = text(postId);
  if (!safeTenantId || !safePostId) return [];
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const channel = normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment";
  const canonicalPostId = canonicalizeSocialCommentThreadPostId({ postId: safePostId, platform: normalizedPlatform });
  const sessionIds = buildSocialCommentThreadSessionVariants({ postId: canonicalPostId || safePostId, platform: normalizedPlatform });
  const sessionPatterns = Array.from(new Set(sessionIds.flatMap((value) => {
    const safeValue = text(value);
    if (!safeValue) return [];
    return [
      `${safeValue}%`,
      safeValue.includes(":") ? safeValue : "",
    ].filter(Boolean);
  })));
  debugSocialCommentsWarn("[social-comments:data-debug]", {
    scope: "service:listSocialCommentThreadComments:before",
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    incomingPostId: safePostId,
    canonical_post_id: canonicalPostId,
    query_variants: sessionIds,
    query_patterns: sessionPatterns,
    whereSessionId: sessionIds,
    wherePostId: canonicalPostId || safePostId,
    whereRootCommentId: "",
  });
  const result = await db.query(
    `
    SELECT
      msg.*,
      run.like_status,
      run.reply_status,
      run.mode AS auto_reply_mode,
      run.decision_reason,
      run.error_message AS automation_error_message,
      run.template_source,
      run.rendered_reply,
      run.sent_at
    FROM ai_support_messages msg
    LEFT JOIN social_comment_auto_reply_runs run
      ON run.tenant_id = msg.tenant_id
     AND run.platform = $3::text
     AND run.comment_id = msg.comment_id
    WHERE msg.tenant_id = $1::bigint
      AND (
        msg.session_id = ANY($2::text[])
        OR msg.session_id LIKE ANY($3::text[])
        OR msg.post_id = $4::text
        OR msg.post_id = ANY($2::text[])
        OR msg.post_id LIKE ANY($3::text[])
      )
      AND msg.message_type = 'comment_inbound'
    ORDER BY NULLIF(msg.comment_created_time, '') ASC NULLS LAST, msg.created_at ASC, msg.id ASC
    `,
    [safeTenantId, sessionIds, sessionPatterns, canonicalPostId || safePostId]
  );
  debugSocialCommentsWarn("[social-comments:data-debug]", {
    scope: "service:listSocialCommentThreadComments:after",
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    incomingPostId: safePostId,
    canonical_post_id: canonicalPostId,
    query_variants: sessionIds,
    query_patterns: sessionPatterns,
    sqlParams: [safeTenantId, sessionIds, sessionPatterns, canonicalPostId || safePostId],
    returnedRows: result.rows?.length || 0,
  });
  const normalizedRows = await Promise.all((result.rows || []).map((row) => normalizeSocialCommentTimelineRow({ tenantId: safeTenantId, row, platform: normalizedPlatform })));
  if (isSocialCommentsDebugEnabled() && normalizedRows.length) {
    console.log("SOCIAL_COMMENT_TIMELINE_NORMALIZED_SAMPLE", {
      tenant_id: safeTenantId,
      platform: normalizedPlatform,
      post_id: canonicalPostId || safePostId,
      sample: normalizedRows.slice(0, 3).map((comment) => ({
        customer_name: comment.customer_name || "",
        customer_avatar_url: comment.customer_avatar_url || "",
        comment_text: comment.comment_text || "",
        created_at: comment.created_at || "",
        platform: comment.platform || "",
        post_id: comment.post_id || "",
        comment_id: comment.comment_id || "",
      })),
    });
  }
  return normalizedRows;
};

const resolveSocialCommentAutoReplyDecision = async ({ tenantId = null, platform = "", postId = "", comment = {}, post = {}, settings = {}, template = null } = {}) => {
  const normalizedPlatform = normalizePlatform(platform);
  const safeComment = comment || {};
  const safePost = post || {};
  const safeSettings = settings || {};
  const postTemplate = template || null;
  const templateSource = postTemplate?.enabled ? "post" : safeSettings.generic_enabled ? "generic" : "";
  const mode = lower(postTemplate?.mode || safeSettings.mode || "manual_approval");
  const likeEnabled = postTemplate ? toBool(postTemplate.like_enabled, true) : toBool(safeSettings.generic_like_enabled, true);
  const replyEnabled = postTemplate ? toBool(postTemplate.reply_enabled, true) : toBool(safeSettings.generic_reply_enabled, true);
  const templateText = text(postTemplate?.template || safeSettings.generic_template || "");
  const context = buildSocialCommentTemplateContext({
    post: safePost,
    comment: safeComment,
    settings: safeSettings,
    template: postTemplate || {},
  });
  const renderedReply = renderSocialCommentTemplateText(templateText, context);
  return {
    platform: normalizedPlatform,
    post_id: text(postId),
    comment_id: text(safeComment.comment_id || safeComment.id || ""),
    template_source: templateSource,
    rendered_reply: renderedReply,
    like_enabled: likeEnabled,
    reply_enabled: replyEnabled,
    mode: SOCIAL_AUTO_REPLY_MODES.has(mode) ? mode : "manual_approval",
    context,
  };
};

let socialCommentAutomationRunColumnsPromise = null;

const getSocialCommentAutomationRunColumns = async () => {
  if (!socialCommentAutomationRunColumnsPromise) {
    socialCommentAutomationRunColumnsPromise = db
      .query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'social_comment_automation_runs'
        `
      )
      .then((result) => new Set((result.rows || []).map((row) => lower(row.column_name))))
      .catch(() => new Set());
  }
  return socialCommentAutomationRunColumnsPromise;
};

const encodeFastListCursor = ({ activityAt = "", id = "" } = {}) => {
  const payload = JSON.stringify({ activity_at: text(activityAt), id: text(id) });
  return Buffer.from(payload, "utf8").toString("base64url");
};

const decodeFastListCursor = (cursor = "") => {
  const raw = text(cursor);
  if (!raw) return { activityAt: "", id: "" };
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return {
      activityAt: text(parsed.activity_at || parsed.activityAt || ""),
      id: text(parsed.id || ""),
    };
  } catch {
    return { activityAt: "", id: "" };
  }
};

const normalizeSocialCommentFastListRow = (row = {}) => {
  const status = text(row.status || row.action_taken || row.public_reply_status || row.dm_status || "pending") || "pending";
  const automationStatus = text(
    row.automation_status ||
      row.reply_status ||
      row.public_reply_status ||
      row.dm_status ||
      row.like_status ||
      row.action_taken ||
      row.status ||
      ""
  );
  const activityAt = text(row.last_activity_at || row.updated_at || row.processed_at || row.created_at || "");
  const unread = !["ignored", "processed", "closed", "resolved"].includes(lower(status)) && !["sent", "delivered"].includes(lower(automationStatus));
  return {
    id: text(row.id || ""),
    platform: text(row.platform || "facebook") || "facebook",
    post_id: text(row.post_id || ""),
    external_comment_id: text(row.external_comment_id || row.comment_id || ""),
    customer_name: text(row.customer_name || row.commenter_name || "Customer") || "Customer",
    customer_avatar_url: text(row.customer_avatar_url || row.commenter_profile_picture_url || ""),
    message_preview: text(row.message_preview || row.original_comment_text || row.comment_text || row.message || "").slice(0, 160),
    last_activity_at: activityAt,
    status,
    automation_status: automationStatus,
    product_id: row.product_id_text ? row.product_id_text : row.product_id ?? row.resolved_product_id ?? null,
    product_name: text(row.product_name || ""),
    unread,
  };
};

export const listSocialCommentCenterFastList = async ({ tenantId = null, platform = "", status = "", limit = 30, cursor = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  if (!safeTenantId) return { items: [], next_cursor: "" };
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  const safeCursor = decodeFastListCursor(cursor);
  const columns = await getSocialCommentAutomationRunColumns();
  const hasStatusColumn = columns.has("status");
  const hasResolvedProductIdColumn = columns.has("resolved_product_id");
  const hasRawPayloadColumn = columns.has("raw_payload");
  const whereClauses = ["tenant_id = $1::bigint"];
  const params = [safeTenantId];
  if (normalizedPlatform === "facebook" || normalizedPlatform === "instagram") {
    whereClauses.push("platform = $2::text");
    params.push(normalizedPlatform);
  }
  if (status) {
    const statusParamIndex = params.length + 1;
    whereClauses.push(
      hasStatusColumn
        ? `LOWER(COALESCE(NULLIF(status, ''), NULLIF(action_taken, ''), NULLIF(public_reply_status, ''), NULLIF(dm_status, ''), '')) = LOWER($${statusParamIndex}::text)`
        : `LOWER(COALESCE(NULLIF(action_taken, ''), NULLIF(public_reply_status, ''), NULLIF(dm_status, ''), '')) = LOWER($${statusParamIndex}::text)`
    );
    params.push(text(status));
  }
  if (safeCursor.activityAt && safeCursor.id) {
    const cursorParamIndex = params.length + 1;
    whereClauses.push(`(COALESCE(updated_at, processed_at, created_at), id) < ($${cursorParamIndex}::timestamp, $${cursorParamIndex + 1}::bigint)`);
    params.push(safeCursor.activityAt, Number(safeCursor.id) || 0);
  }
  const result = await db.query(
    `
    WITH source_rows AS (
      SELECT
        id,
        platform,
        post_id,
        comment_id,
        commenter_name,
        commenter_profile_picture_url,
        original_comment_text,
        action_taken,
        public_reply_status,
        dm_status,
        like_status,
        created_at,
        updated_at,
        processed_at,
        ${hasStatusColumn ? "status" : "NULL::text AS status"},
        ${hasResolvedProductIdColumn ? "resolved_product_id" : "NULL::bigint AS resolved_product_id"},
        ${hasRawPayloadColumn ? "COALESCE(raw_payload, '{}'::jsonb) AS raw_payload" : "'{}'::jsonb AS raw_payload"},
        COALESCE(automation_state, '{}'::jsonb) AS automation_state,
        COALESCE(updated_at, processed_at, created_at) AS last_activity_at
      FROM social_comment_automation_runs
      WHERE ${whereClauses.join(" AND ")}
    )
    SELECT
      source_rows.id,
      source_rows.platform,
      source_rows.post_id,
      source_rows.comment_id,
      COALESCE(NULLIF(source_rows.commenter_name, ''), 'Customer') AS customer_name,
      COALESCE(NULLIF(source_rows.commenter_profile_picture_url, ''), '') AS customer_avatar_url,
      COALESCE(NULLIF(source_rows.original_comment_text, ''), NULLIF(source_rows.raw_payload->>'message', ''), NULLIF(source_rows.raw_payload->>'comment_text', ''), '') AS message_preview,
      source_rows.last_activity_at,
      COALESCE(NULLIF(source_rows.status, ''), NULLIF(source_rows.action_taken, ''), NULLIF(source_rows.public_reply_status, ''), NULLIF(source_rows.dm_status, ''), 'pending') AS status,
      COALESCE(NULLIF(source_rows.public_reply_status, ''), NULLIF(source_rows.dm_status, ''), NULLIF(source_rows.like_status, ''), NULLIF(source_rows.action_taken, ''), NULLIF(source_rows.status, ''), '') AS automation_status,
      COALESCE(NULLIF(source_rows.raw_payload->'product_context'->>'product_id', ''), NULLIF(source_rows.automation_state->'product_context'->>'product_id', ''), NULLIF(source_rows.resolved_product_id::text, '')) AS product_id_text,
      COALESCE(NULLIF(source_rows.raw_payload->'product_context'->>'product_name', ''), NULLIF(source_rows.automation_state->'product_context'->>'product_name', ''), '') AS product_name
    FROM source_rows
    ORDER BY source_rows.last_activity_at DESC, source_rows.id DESC
    LIMIT $${params.length + 1}
    `,
    [...params, safeLimit + 1]
  );
  const items = (result.rows || []).map(normalizeSocialCommentFastListRow);
  const nextItems = items.slice(0, safeLimit);
  const lastItem = nextItems[nextItems.length - 1] || null;
  return {
    items: nextItems,
    next_cursor: items.length > safeLimit && lastItem?.last_activity_at && lastItem?.id ? encodeFastListCursor({ activityAt: lastItem.last_activity_at, id: lastItem.id }) : "",
  };
};

const upsertSocialCommentAutoReplyRun = async ({ tenantId = null, platform = "", postId = "", commentId = "", payload = {} } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  if (!safeTenantId || !text(commentId)) return null;
  await ensureSocialCommentsCenterSchema();
  const result = await db.query(
    `
    INSERT INTO social_comment_auto_reply_runs (
      tenant_id,
      platform,
      post_id,
      comment_id,
      template_source,
      rendered_reply,
      like_status,
      reply_status,
      mode,
      decision_reason,
      error_message,
      sent_at,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
      CASE WHEN $12::text = 'sent' OR $13::text = 'sent' THEN CURRENT_TIMESTAMP ELSE NULL END,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (tenant_id, platform, comment_id) DO UPDATE SET
      post_id = EXCLUDED.post_id,
      template_source = EXCLUDED.template_source,
      rendered_reply = EXCLUDED.rendered_reply,
      like_status = EXCLUDED.like_status,
      reply_status = EXCLUDED.reply_status,
      mode = EXCLUDED.mode,
      decision_reason = EXCLUDED.decision_reason,
      error_message = EXCLUDED.error_message,
      sent_at = COALESCE(social_comment_auto_reply_runs.sent_at, EXCLUDED.sent_at),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *
    `,
    [
      safeTenantId,
      normalizePlatform(platform),
      text(postId),
      text(commentId),
      text(payload.template_source || ""),
      text(payload.rendered_reply || ""),
      text(payload.like_status || "pending"),
      text(payload.reply_status || "pending"),
      text(payload.mode || "manual_approval"),
      text(payload.decision_reason || ""),
      text(payload.error_message || ""),
      text(payload.like_status || ""),
      text(payload.reply_status || ""),
    ]
  );
  return result.rows?.[0] || null;
};

const getSocialCommentPostByCommentId = async ({ tenantId = null, platform = "", commentId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeCommentId = text(commentId);
  if (!safeTenantId || !safeCommentId) return null;
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const result = await db.query(
    `
    SELECT
      c.tenant_id,
      c.channel,
      CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END AS platform,
      c.thread_kind,
      c.external_conversation_id AS conversation_id,
      c.external_customer_id,
      c.customer_name,
      c.customer_avatar_url,
      c.last_message,
      c.last_message_at,
      COALESCE(c.metadata->>'post_full_picture', c.metadata->>'full_picture', '') AS post_full_picture,
      COALESCE(c.metadata->>'attachment_image', '') AS attachment_image,
      COALESCE(c.metadata->>'post_thumbnail', c.metadata->>'thumbnail_url', '') AS post_thumbnail,
      COALESCE(c.metadata->>'post_caption', c.metadata->>'post_message', c.metadata->>'caption', '') AS post_caption,
      COALESCE(c.metadata->>'post_message', c.metadata->>'message', '') AS post_message,
      COALESCE(c.metadata->>'post_permalink_url', c.metadata->>'post_permalink', c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS post_permalink_url,
      COALESCE(c.metadata->>'permalink_url', c.metadata->>'post_url', '') AS permalink_url,
      COALESCE(c.metadata->>'thumbnail_url', '') AS thumbnail_url,
      c.metadata,
      runmeta.automation_run_post_id,
      runmeta.automation_run_raw_payload,
      s.read_at AS session_read_at,
      s.status AS session_status,
      s.updated_at AS session_updated_at
    FROM ai_channel_conversations c
    LEFT JOIN ai_support_sessions s
      ON s.tenant_id = c.tenant_id
     AND s.session_id = c.external_conversation_id
    LEFT JOIN LATERAL (
      SELECT
        (ARRAY_AGG(r.post_id ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_post_id,
        (ARRAY_AGG(r.raw_payload ORDER BY r.created_at DESC, r.id DESC))[1] AS automation_run_raw_payload
      FROM social_comment_automation_runs r
      WHERE r.tenant_id = c.tenant_id
        AND r.platform = CASE WHEN c.channel = 'instagram_comment' THEN 'instagram' ELSE 'facebook' END
        AND r.inbox_conversation_id = c.external_conversation_id
    ) runmeta ON TRUE
    INNER JOIN ai_support_messages msg
      ON msg.tenant_id = c.tenant_id
     AND msg.session_id = c.external_conversation_id
     AND msg.comment_id = $2::text
    WHERE c.tenant_id = $1::bigint
      AND c.channel = $3::text
      AND c.thread_kind = 'comment'
    LIMIT 1
    `,
    [safeTenantId, safeCommentId, normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"]
  );
  const row = result.rows?.[0] || null;
  return row ? await enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform }) : null;
};

const getSocialCommentCommentByCommentId = async ({ tenantId = null, platform = "", commentId = "" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeCommentId = text(commentId);
  if (!safeTenantId || !safeCommentId) return null;
  await ensureSocialCommentsCenterSchema();
  const normalizedPlatform = normalizePlatform(platform);
  const lookupColumnsChecked = [
    "ai_support_messages.comment_id",
    "ai_support_messages.external_message_id",
    "ai_support_messages.provider_message_id",
    "ai_support_messages.external_reply_id",
    "social_comment_automation_runs.comment_id",
    "social_comment_automation_runs.inbox_conversation_id",
  ];
  const result = await db.query(
    `
    SELECT
      msg.*,
      run.like_status,
      run.reply_status,
      run.mode AS auto_reply_mode,
      run.decision_reason,
      run.error_message AS automation_error_message,
      run.template_source,
      run.rendered_reply,
      run.sent_at
    FROM ai_support_messages msg
    LEFT JOIN social_comment_auto_reply_runs run
      ON run.tenant_id = msg.tenant_id
     AND run.platform = $3::text
     AND run.comment_id = msg.comment_id
    WHERE msg.tenant_id = $1::bigint
      AND msg.message_type = 'comment_inbound'
      AND (
        msg.comment_id = $2::text
        OR msg.external_message_id = $2::text
        OR msg.provider_message_id = $2::text
        OR msg.external_reply_id = $2::text
      )
    LIMIT 1
    `,
    [safeTenantId, safeCommentId, normalizedPlatform]
  );
  const directRow = result.rows?.[0] || null;
  if (directRow) {
    console.warn("[social-comments:preview-lookup-debug]", {
      incoming_comment_id: safeCommentId,
      lookup_columns_checked: lookupColumnsChecked,
      matched_table: "ai_support_messages",
      matched_row_id: text(directRow.id || directRow.comment_id || directRow.external_message_id || directRow.provider_message_id || ""),
    });
    return normalizeSocialCommentTimelineRow({ tenantId: safeTenantId, row: directRow, platform: normalizedPlatform });
  }

  const runResult = await db.query(
    `
    SELECT *
    FROM social_comment_auto_reply_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, safeCommentId]
  );
  const runRow = runResult.rows?.[0] || null;
  if (runRow) {
    const rawPayload = metadataObject(runRow.raw_payload || {});
    const payloadValue = metadataObject(rawPayload.value || {});
    const fallbackComment = {
      id: text(runRow.comment_id || safeCommentId),
      comment_id: text(runRow.comment_id || safeCommentId),
      external_message_id: text(runRow.comment_id || safeCommentId),
      provider_message_id: text(runRow.comment_id || safeCommentId),
      message: text(
        payloadValue.message ||
        payloadValue.text ||
        rawPayload.message ||
        rawPayload.text ||
        runRow.original_comment_text ||
        ""
      ),
      customer_name: text(
        payloadValue.from?.name ||
        rawPayload.from?.name ||
        runRow.commenter_name ||
        "عميل"
      ),
      commenter_name: text(
        payloadValue.from?.name ||
        rawPayload.from?.name ||
        runRow.commenter_name ||
        "عميل"
      ),
      customer_avatar_url: text(
        payloadValue.from?.picture ||
        rawPayload.from?.picture ||
        runRow.commenter_profile_picture_url ||
        ""
      ),
      commenter_profile_picture_url: text(
        payloadValue.from?.picture ||
        rawPayload.from?.picture ||
        runRow.commenter_profile_picture_url ||
        ""
      ),
      post_id: text(
        runRow.post_id ||
        payloadValue.post_id ||
        rawPayload.post_id ||
        rawPayload.value?.post_id ||
        ""
      ),
      platform: normalizedPlatform,
      reply_status: text(runRow.reply_status || "pending"),
      like_status: text(runRow.like_status || "pending"),
      auto_reply_mode: text(runRow.mode || "manual_approval"),
      metadata: {
        ...(rawPayload && typeof rawPayload === "object" ? rawPayload : {}),
        post_id: text(runRow.post_id || payloadValue.post_id || rawPayload.post_id || rawPayload.value?.post_id || ""),
        comment_id: text(runRow.comment_id || safeCommentId),
        inbox_conversation_id: text(runRow.inbox_conversation_id || ""),
      },
      raw: {
        ...runRow,
        raw_payload: rawPayload,
      },
    };
    console.warn("[social-comments:preview-lookup-debug]", {
      incoming_comment_id: safeCommentId,
      lookup_columns_checked: lookupColumnsChecked,
      matched_table: "social_comment_automation_runs",
      matched_row_id: text(runRow.id || runRow.comment_id || ""),
    });
    return normalizeSocialCommentTimelineRow({ tenantId: safeTenantId, row: fallbackComment, platform: normalizedPlatform });
  }

  console.warn("[social-comments:preview-lookup-debug]", {
    incoming_comment_id: safeCommentId,
    lookup_columns_checked: lookupColumnsChecked,
    matched_table: "",
    matched_row_id: "",
  });
  return null;
};

const processSocialCommentAutoReply = async ({ tenantId = null, platform = "", postId = "", commentId = "", comment = null, post = null, settings = null, template = null, force = false } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const normalizedPlatform = normalizePlatform(platform);
  const safeCommentId = text(commentId || comment?.comment_id || comment?.id || "");
  const safePostId = text(postId || post?.post_id || post?.metadata?.post_id || "");
  if (!safeTenantId || !safeCommentId || !safePostId) {
    return { success: false, skipped: true, reason: "missing_identifiers" };
  }
  await ensureSocialCommentsCenterSchema();
  const existing = await db.query(
    `
    SELECT *
    FROM social_comment_auto_reply_runs
    WHERE tenant_id = $1::bigint
      AND platform = $2::text
      AND comment_id = $3::text
    LIMIT 1
    `,
    [safeTenantId, normalizedPlatform, safeCommentId]
  );
  if (existing.rows?.[0]?.reply_status === "sent" || existing.rows?.[0]?.like_status === "sent") {
    return { success: true, skipped: true, reason: "already_processed", run: existing.rows[0] };
  }

  const resolvedPost = post || (await loadSocialCommentPost({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }));
  const resolvedComment = comment || (await getSocialCommentCommentByCommentId({ tenantId: safeTenantId, platform: normalizedPlatform, commentId: safeCommentId }));
  const resolvedSettings = settings || (await getSocialAutoReplySettings({ tenantId: safeTenantId }));
  const resolvedTemplate = template || (await getSocialPostAutoReplyTemplate({ tenantId: safeTenantId, platform: normalizedPlatform, postId: safePostId }));
  const decision = await resolveSocialCommentAutoReplyDecision({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    comment: resolvedComment || comment || {},
    post: resolvedPost || post || {},
    settings: resolvedSettings,
    template: resolvedTemplate,
  });
  const commenterId = text(resolvedComment?.commenter_id || resolvedComment?.customer_id || comment?.commenter_id || "");
  const pageId = text(resolvedPost?.metadata?.page_id || resolvedPost?.metadata?.facebook_page_id || "");
  if (commenterId && pageId && commenterId === pageId) {
    return upsertSocialCommentAutoReplyRun({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      payload: {
        template_source: decision.template_source,
        rendered_reply: decision.rendered_reply,
        like_status: "skipped",
        reply_status: "skipped",
        mode: decision.mode,
        decision_reason: "page_self_comment",
      },
    });
  }

  const mode = decision.mode;
  const likeEnabled = decision.like_enabled;
  const replyEnabled = decision.reply_enabled;
  const canSend = force || mode === "full_auto";
  const canDraft = mode === "draft" || mode === "manual_approval";
  let likeStatus = "skipped";
  let replyStatus = "skipped";
  let errorMessage = "";

  if (mode === "off") {
    return upsertSocialCommentAutoReplyRun({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      payload: {
        template_source: decision.template_source,
        rendered_reply: decision.rendered_reply,
        like_status: "skipped",
        reply_status: "skipped",
        mode,
        decision_reason: "mode_off",
      },
    });
  }

  if (canDraft && !force) {
    return upsertSocialCommentAutoReplyRun({
      tenantId: safeTenantId,
      platform: normalizedPlatform,
      postId: safePostId,
      commentId: safeCommentId,
      payload: {
        template_source: decision.template_source,
        rendered_reply: decision.rendered_reply,
        like_status: likeEnabled ? "pending" : "skipped",
        reply_status: replyEnabled ? "pending" : "skipped",
        mode,
        decision_reason: "draft_or_manual_approval",
      },
    });
  }

  try {
    if (likeEnabled) {
      await likeComment(normalizedPlatform, safeCommentId, safeTenantId);
      likeStatus = "sent";
      console.log("SOCIAL_COMMENT_AUTOMATION_COMMENT_LIKED", {
        tenant_id: safeTenantId,
        platform: normalizedPlatform,
        post_id: safePostId,
        comment_id: safeCommentId,
      });
    }
  } catch (error) {
    likeStatus = "failed";
    errorMessage = error?.message || "Like failed";
  }

  try {
    if (replyEnabled && decision.rendered_reply) {
      await replyToComment(normalizedPlatform, safeCommentId, decision.rendered_reply, safeTenantId);
      replyStatus = "sent";
      console.log("SOCIAL_COMMENT_AUTOMATION_PUBLIC_REPLY_SENT", {
        tenant_id: safeTenantId,
        platform: normalizedPlatform,
        post_id: safePostId,
        comment_id: safeCommentId,
      });
    } else if (replyEnabled) {
      replyStatus = "skipped";
    }
  } catch (error) {
    replyStatus = "failed";
    errorMessage = errorMessage || error?.message || "Reply failed";
  }

  const run = await upsertSocialCommentAutoReplyRun({
    tenantId: safeTenantId,
    platform: normalizedPlatform,
    postId: safePostId,
    commentId: safeCommentId,
    payload: {
      template_source: decision.template_source,
      rendered_reply: decision.rendered_reply,
      like_status: likeStatus,
      reply_status: replyStatus,
      mode,
      decision_reason: canSend ? "full_auto" : "manual_trigger",
      error_message: errorMessage,
    },
  });

  return {
    success: likeStatus === "sent" || replyStatus === "sent" || canDraft,
    like_status: likeStatus,
    reply_status: replyStatus,
    rendered_reply: decision.rendered_reply,
    template_source: decision.template_source,
    mode,
    run,
  };
};

const ignoreSocialComment = async ({ tenantId = null, platform = "", postId = "", commentId = "", reason = "ignored" } = {}) => {
  const safeTenantId = toTenantId(tenantId);
  const safeCommentId = text(commentId);
  if (!safeTenantId || !safeCommentId) return null;
  return upsertSocialCommentAutoReplyRun({
    tenantId: safeTenantId,
    platform,
    postId,
    commentId: safeCommentId,
    payload: {
      template_source: "none",
      rendered_reply: "",
      like_status: "skipped",
      reply_status: "skipped",
      mode: "off",
      decision_reason: reason,
    },
  });
};

export {
  ensureSocialCommentsCenterSchema,
  getSocialAutoReplySettings,
  saveSocialAutoReplySettings,
  getSocialPostAutoReplyTemplate,
  saveSocialPostAutoReplyTemplate,
  listSocialCommentPosts,
  backfillSocialCommentPostMedia,
  listSocialCommentThreadComments,
  getSocialCommentPostByCommentId,
  getSocialCommentCommentByCommentId,
  processSocialCommentAutoReply,
  ignoreSocialComment,
  resolveSocialCommentAutoReplyDecision,
  renderSocialCommentTemplateText,
};
