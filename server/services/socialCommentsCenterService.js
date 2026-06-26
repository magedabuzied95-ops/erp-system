import db from "../database/db.js";
import { ensureAiSalesAgentSchema } from "./aiSalesAgentService.js";
import { ensureAiSupportLogSchema } from "./aiSupportLogService.js";
import { fetchMetaPostPreviewDetails } from "./metaIntegrationService.js";
import { likeComment, replyToComment, renderTemplate } from "./marketingCommentAutomationService.js";

const text = (value = "") => String(value ?? "").trim();
const lower = (value = "") => text(value).toLowerCase();
const asArray = (value) => (Array.isArray(value) ? value : []);
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
  await db.query(`ALTER TABLE IF EXISTS social_comment_auto_reply_runs ADD COLUMN IF NOT EXISTS reply_status TEXT NOT NULL DEFAULT 'pending'`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_auto_reply_settings_updated ON social_auto_reply_settings (updated_at DESC)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_post_auto_reply_templates_lookup ON social_post_auto_reply_templates (tenant_id, platform, post_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_social_comment_auto_reply_runs_lookup ON social_comment_auto_reply_runs (tenant_id, platform, comment_id)`);
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
  const postId = text(safeRow.post_id || safeRow.conversation_id || metadata.post_id || "");
  const pageId = text(metadata.page_id || metadata.facebook_page_id || "");
  const currentDetails = resolvePostThumbnailDetails(safeRow);
  const currentHasThumbnail = Boolean(currentDetails.has_thumbnail);
  const unsupportedGraphMedia = currentDetails.reason_if_missing === "deprecated_status_no_graph_media" || lower(metadata.media_enrichment_status) === "unsupported_deprecated_status";
  const needsGraph = !unsupportedGraphMedia && (!currentDetails.has_thumbnail || !resolvePostPreviewCaption(safeRow) || !resolvePostPreviewLink(safeRow));
  if (!tenantId || !postId || !needsGraph) {
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
    };
  }
  try {
    const graphPost = await fetchMetaPostPreviewDetails({
      tenantId,
      postId,
      pageId,
      permalinkUrl: safeRow.post_permalink_url || safeRow.permalink_url || metadata.post_permalink_url || metadata.permalink_url || "",
    }).catch(() => null);
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
        return {
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
        };
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
        return {
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
        };
      }
      return {
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
      };
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
  } catch {
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
  return result.rows?.[0] || null;
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
    customer_name: text(comment.commenter_name || comment.customer_name || "Customer"),
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

const renderSocialCommentTemplateText = (templateText = "", context = {}) =>
  text(templateText).replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = leftKey || rightKey || "";
    return text(context[key] ?? context[key.toLowerCase()] ?? "");
  });

const loadSocialCommentPost = async ({ tenantId = null, platform = "", postId = "" } = {}) => {
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
        COUNT(*)::int AS comments_count,
        COUNT(*) FILTER (WHERE msg.created_at > COALESCE(c.read_at, s.read_at))::int AS new_comments_count,
        MAX(msg.created_at) AS last_comment_at,
        (ARRAY_AGG(msg.customer_message ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_comment_text,
        (ARRAY_AGG(msg.customer_name ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_commenter_name,
        (ARRAY_AGG(msg.commenter_id ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_commenter_id,
        (ARRAY_AGG(msg.comment_id ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_comment_id
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
    WHERE c.tenant_id = $1::bigint
      AND c.metadata->>'post_id' = $2::text
      AND c.channel = $3::text
    LIMIT 1
    `,
    [safeTenantId, safePostId, normalizedPlatform === "instagram" ? "instagram_comment" : "facebook_comment"]
  );
  const row = result.rows?.[0] || null;
  return row ? await enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform }) : null;
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
        COUNT(*)::int AS comments_count,
        COUNT(*) FILTER (WHERE msg.created_at > COALESCE(c.read_at, s.read_at))::int AS new_comments_count,
        MAX(msg.created_at) AS last_comment_at,
        (ARRAY_AGG(msg.customer_message ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_comment_text,
        (ARRAY_AGG(msg.customer_name ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_commenter_name,
        (ARRAY_AGG(msg.commenter_id ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_commenter_id,
        (ARRAY_AGG(msg.comment_id ORDER BY msg.created_at DESC, msg.id DESC))[1] AS last_comment_id
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
    `,
    [safeTenantId, safeLimit]
  );
  return Promise.all((result.rows || []).map((row) => enrichSocialCommentPostRow({ tenantId: safeTenantId, row, platform: normalizedPlatform })));
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
    LEFT JOIN social_comment_automation_runs run
      ON run.tenant_id = msg.tenant_id
     AND run.platform = $3::text
     AND run.comment_id = msg.comment_id
    WHERE msg.tenant_id = $1::bigint
      AND msg.session_id = $2::text
      AND msg.message_type = 'comment_inbound'
    ORDER BY msg.created_at ASC, msg.id ASC
    `,
    [safeTenantId, `${normalizedPlatform}_post:${safePostId}`, normalizedPlatform]
  );
  return result.rows || [];
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
      s.read_at AS session_read_at,
      s.status AS session_status,
      s.updated_at AS session_updated_at
    FROM ai_channel_conversations c
    LEFT JOIN ai_support_sessions s
      ON s.tenant_id = c.tenant_id
     AND s.session_id = c.external_conversation_id
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
      AND msg.comment_id = $2::text
      AND msg.message_type = 'comment_inbound'
    LIMIT 1
    `,
    [safeTenantId, safeCommentId, normalizedPlatform]
  );
  return result.rows?.[0] || null;
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
    }
  } catch (error) {
    likeStatus = "failed";
    errorMessage = error?.message || "Like failed";
  }

  try {
    if (replyEnabled && decision.rendered_reply) {
      await replyToComment(normalizedPlatform, safeCommentId, decision.rendered_reply, safeTenantId);
      replyStatus = "sent";
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
  loadSocialCommentPost,
  getSocialCommentPostByCommentId,
  getSocialCommentCommentByCommentId,
  processSocialCommentAutoReply,
  ignoreSocialComment,
  resolveSocialCommentAutoReplyDecision,
  renderSocialCommentTemplateText,
};
