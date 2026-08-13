import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Clock3,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  Sparkles,
  ShoppingBag,
  ThumbsUp,
  UserRound,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import { api } from "../../../shared/api/api";
import { VirtualList } from "../../../shared/components/VirtualList";
import SocialAutomationDrawer from "./socialAutomation/SocialAutomationDrawer.jsx";
import PostProductLinksDrawer from "./socialAutomation/PostProductLinksDrawer.jsx";
import {
  applyAutomationTemplate,
  buildAutomationDraft,
  normalizeAutomationConfig,
  serializeAutomationDraft,
} from "./socialAutomation/automationEngine.js";
import { CommentTimelineCard, getSocialCommentRealTimestamp } from "./socialCommentTimeline.jsx";

import { useRef } from "react";

const clean = (value = "") => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const isGenericCommenterName = (value = "") => /^(customer|unknown|guest|anonymous|عميل|العميل|\d+)$/i.test(clean(value));
const firstCommenterName = (...values) => values.map((value) => clean(value)).find((value) => value && !isGenericCommenterName(value)) || "";
const isSocialDebugEnabled = () => import.meta.env.DEV && window.localStorage.getItem("social_debug") === "1";
const socialDebugLog = (...args) => {
  if (isSocialDebugEnabled()) console.log(...args);
};
const isEventLikeObject = (value) =>
  Boolean(
    value &&
    typeof value === "object" &&
    (
      typeof value.preventDefault === "function" ||
      typeof value.stopPropagation === "function" ||
      Object.prototype.hasOwnProperty.call(value, "nativeEvent") ||
      Object.prototype.hasOwnProperty.call(value, "target")
    )
  );

const toArray = (value) => (Array.isArray(value) ? value : []);

const normalizeExternalSocialUrl = (value = "") => {
  const candidate = clean(value);
  if (!candidate) return "";
  if (/^social_comment:/i.test(candidate)) return "";
  if (/^\/marketing\/social-comments/i.test(candidate)) return "";
  if (/^https?:\/\/[^/]+\/marketing\/social-comments/i.test(candidate)) return "";
  return candidate;
};

const buildFacebookPostUrlFromId = (value = "") => {
  const candidate = clean(value);
  if (!candidate || /^social_comment:/i.test(candidate)) return "";
  const segments = candidate.split("_").map((part) => clean(part)).filter(Boolean);
  if (segments.length >= 2) {
    return `https://www.facebook.com/${segments[0]}/posts/${segments[1]}`;
  }
  return /^\d+$/.test(candidate) ? `https://www.facebook.com/${candidate}` : "";
};

const buildCanonicalSocialPostUrl = (post = {}) => {
  const metadata = post?.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const raw = post?.raw && typeof post.raw === "object" && !Array.isArray(post.raw) ? post.raw : {};
  const platform = clean(post?.platform || metadata?.platform || raw?.platform || "facebook").toLowerCase();
  const platformPostId = [
    post?.platformPostId,
    post?.platform_post_id,
    post?.sourcePostId,
    post?.source_post_id,
    post?.canonicalPostId,
    post?.canonical_post_id,
    post?.postId,
    post?.post_id,
    raw?.platform_post_id,
    raw?.post_id,
    metadata?.platform_post_id,
    metadata?.post_id,
  ]
    .map((value) => clean(value))
    .find(Boolean);
  if (platform.includes("facebook")) {
    return buildFacebookPostUrlFromId(platformPostId);
  }
  return "";
};

const pictureUrlFrom = (value = "") => {
  if (!value) return "";
  if (typeof value === "string") return clean(value);
  if (typeof value !== "object") return clean(value);
  return clean(value.data?.url || value.url || value.picture?.data?.url || value.picture?.url || value.profile_pic_url || value.profile_pic || value.source || "");
};

const isSmallNumericId = (value = "") => {
  const candidate = clean(value);
  return Boolean(candidate) && /^\d+$/.test(candidate) && candidate.length < 10;
};

const getSocialCommentActionIdCandidates = (comment = {}) => {
  const metadata = comment?.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : {};
  const raw = comment?.raw && typeof comment.raw === "object" && !Array.isArray(comment.raw) ? comment.raw : {};
  return [
    { source: "raw.comment_id", value: clean(raw.comment_id || "") },
    { source: "raw.external_comment_id", value: clean(raw.external_comment_id || "") },
    { source: "raw.provider_comment_id", value: clean(raw.provider_comment_id || "") },
    { source: "raw.external_message_id", value: clean(raw.external_message_id || "") },
    { source: "raw.provider_message_id", value: clean(raw.provider_message_id || "") },
    { source: "metadata.comment_id", value: clean(metadata.comment_id || "") },
    { source: "metadata.external_comment_id", value: clean(metadata.external_comment_id || "") },
    { source: "metadata.provider_comment_id", value: clean(metadata.provider_comment_id || "") },
    { source: "metadata.external_message_id", value: clean(metadata.external_message_id || "") },
    { source: "metadata.provider_message_id", value: clean(metadata.provider_message_id || "") },
    { source: "comment.external_comment_id", value: clean(comment?.external_comment_id || "") },
    { source: "comment.provider_comment_id", value: clean(comment?.provider_comment_id || "") },
    { source: "comment.external_message_id", value: clean(comment?.external_message_id || "") },
    { source: "comment.provider_message_id", value: clean(comment?.provider_message_id || "") },
    { source: "comment.comment_id", value: clean(comment?.comment_id || "") },
    { source: "comment.id", value: clean(comment?.id || "") },
  ];
};

const resolveSocialCommentActionId = (comment = {}) => {
  const candidates = getSocialCommentActionIdCandidates(comment);
  const preferred = candidates.find(({ source, value }) => value && source !== "comment.id" && !isSmallNumericId(value));
  return clean(preferred?.value || "");
};

const getSocialCommentActionDebugData = (comment = {}) => {
  const raw = comment?.raw && typeof comment.raw === "object" && !Array.isArray(comment.raw) ? comment.raw : {};
  const rawMetadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const metadata = comment?.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : rawMetadata;
  return {
    clicked_comment_text: clean(comment.message || raw.message || raw.customer_message || metadata.message || metadata.customer_message || ""),
    clicked_comment_id: clean(comment.id || raw.id || metadata.id || ""),
    clicked_comment_comment_id: clean(comment.comment_id || raw.comment_id || metadata.comment_id || ""),
    clicked_comment_metadata_comment_id: clean(metadata.comment_id || rawMetadata.comment_id || ""),
  };
};

const absoluteTime = (value) => {
  if (!value) return dash;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return dash;
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
};

function normalizeComment(raw) {
  const comment = raw || {};
  const metadata = comment.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : {};
  const rawPayload = comment.raw_payload && typeof comment.raw_payload === "object" && !Array.isArray(comment.raw_payload) ? comment.raw_payload : {};
  const rawValue = rawPayload.value && typeof rawPayload.value === "object" && !Array.isArray(rawPayload.value) ? rawPayload.value : {};
  const rawComment = rawValue.comment || rawPayload.comment || {};
  const rawFrom = rawValue.from || rawPayload.from || rawComment.from || {};
  const automationState = comment.automation_state && typeof comment.automation_state === "object" && !Array.isArray(comment.automation_state) ? comment.automation_state : {};
  const runtimeMonitor =
    automationState.runtime_monitor && typeof automationState.runtime_monitor === "object" && !Array.isArray(automationState.runtime_monitor)
      ? automationState.runtime_monitor
      : {};
  const aiSales =
    runtimeMonitor.ai_sales && typeof runtimeMonitor.ai_sales === "object" && !Array.isArray(runtimeMonitor.ai_sales)
      ? runtimeMonitor.ai_sales
      : automationState.social_comment_runtime?.ai_sales && typeof automationState.social_comment_runtime.ai_sales === "object" && !Array.isArray(automationState.social_comment_runtime.ai_sales)
        ? automationState.social_comment_runtime.ai_sales
        : {};
  const customerName = firstCommenterName(
    comment.customer_name,
    comment.commenter_name,
    comment.from?.name,
    metadata.customer_name,
    metadata.commenter_name,
    metadata.from?.name,
    rawFrom?.name,
    rawFrom?.full_name,
    rawFrom?.username
  ) || "عميل";
  const customerAvatarUrl = clean(
    comment.customer_avatar_url ||
      comment.commenter_profile_picture_url ||
      pictureUrlFrom(comment.from?.picture) ||
      comment.profile_pic_url ||
      comment.profile_picture_url ||
      comment.customer_avatar ||
      comment.avatar ||
      comment.avatar_url ||
      comment.profile_pic ||
      metadata.customer_avatar_url ||
      metadata.commenter_profile_picture_url ||
      pictureUrlFrom(metadata.from?.picture) ||
      metadata.profile_pic_url ||
      metadata.profile_picture_url ||
      metadata.customer_avatar ||
      metadata.avatar ||
      metadata.avatar_url ||
      metadata.profile_pic ||
      pictureUrlFrom(rawFrom?.picture) ||
      pictureUrlFrom(rawFrom?.profile_pic) ||
      pictureUrlFrom(rawFrom?.profile_picture_url) ||
      ""
  );
  const createdAt = getSocialCommentRealTimestamp({ ...comment, raw: comment }).timestamp;
  return {
    id: clean(comment.comment_id || comment.id || comment.external_message_id || comment.provider_message_id || metadata.comment_id || ""),
    message: clean(comment.comment_text || comment.customer_message || comment.message || comment.text || comment.message_text || comment.original_comment_text || metadata.comment_text || metadata.customer_message || metadata.message || ""),
    customerName,
    customer_name: customerName,
    customerAvatar: customerAvatarUrl,
    customer_avatar_url: customerAvatarUrl,
    commenter_profile_picture_url: customerAvatarUrl,
    classification: clean(comment.classification_label || comment.classification || comment.intent || metadata.classification_label || metadata.classification || metadata.intent || "Question"),
    replyStatus: clean(comment.reply_status || metadata.reply_status || "pending"),
    createdTime: createdAt,
    created_at: createdAt,
    created_time: createdAt,
    metadata,
    postId: clean(comment.post_id || comment.conversation_post_id || comment.thread_post_id || metadata.post_id || ""),
    post_id: clean(comment.post_id || comment.conversation_post_id || comment.thread_post_id || metadata.post_id || ""),
    platform: clean(comment.platform || metadata.platform || ""),
    permalinkUrl: clean(comment.permalink_url || comment.comment_url || metadata.permalink_url || metadata.comment_url || ""),
    replyText: clean(comment.reply_text || comment.rendered_reply || metadata.reply_text || metadata.rendered_reply || ""),
    detected_intent: clean(comment.detected_intent || runtimeMonitor.detected_intent || aiSales.intent || metadata.detected_intent || ""),
    generated_public_reply: clean(comment.generated_public_reply || runtimeMonitor.generated_public_reply || aiSales.public_reply || ""),
    generated_private_reply: clean(comment.generated_private_reply || runtimeMonitor.generated_private_reply || aiSales.private_reply || ""),
    approval_status: clean(comment.approval_status || runtimeMonitor.approval_status || aiSales.approval_status || ""),
    automation_state: automationState,
    raw: comment,
  };
};

function normalizePost(raw) {
  const post = raw || {};
  const metadata = post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const mappingSummary = post.mapping_summary && typeof post.mapping_summary === "object" && !Array.isArray(post.mapping_summary) ? post.mapping_summary : {};
  const attachmentImage = getAttachmentImage(post);
  const postLinkKeyRaw = clean(
    post.post_link_key ||
      post.postLinkKey ||
      metadata.post_link_key ||
      metadata.postLinkKey ||
      mappingSummary.post_link_key ||
      mappingSummary.postLinkKey ||
      ""
  );
  const linkedProducts = Array.isArray(post.linked_products)
    ? post.linked_products
    : Array.isArray(metadata.linked_products)
      ? metadata.linked_products
      : Array.isArray(mappingSummary.linked_products)
        ? mappingSummary.linked_products
        : [];
  const linkedProductsCount = Number(
    post.linked_products_count ??
      post.product_links_count ??
      metadata.linked_products_count ??
      metadata.product_links_count ??
      mappingSummary.count ??
      linkedProducts.length ??
      0
  ) || 0;
  const productLinkSourceRaw = clean(post.product_link_source || metadata.product_link_source || mappingSummary.product_link_source || "none") || "none";
  const hasDirectProductLink = Boolean(
    (post.has_direct_product_link ?? metadata.has_direct_product_link ?? false) ||
    productLinkSourceRaw === "direct" ||
    productLinkSourceRaw === "v2_direct" ||
    linkedProductsCount > 0 ||
    linkedProducts.length > 0
  );
  const productLinkSource = hasDirectProductLink && productLinkSourceRaw === "none" ? "v2_direct" : productLinkSourceRaw;
  const hasSiblingProductContext = Boolean(
    post.has_sibling_product_context ??
    metadata.has_sibling_product_context ??
    (productLinkSource === "sibling")
  );
  const primaryLinkedProduct = post.primary_linked_product || post.primary_product || metadata.primary_linked_product || metadata.primary_product || mappingSummary.primary_linked_product || mappingSummary.primary_product || linkedProducts[0] || null;
  const productLinkIdentity = post.product_link_identity || metadata.product_link_identity || mappingSummary.product_link_identity || post.post_identity || metadata.post_identity || null;
  const productLinkKey = clean(
    postLinkKeyRaw ||
      productLinkIdentity?.product_link_key ||
      productLinkIdentity?.post_id ||
      productLinkIdentity?.canonical_post_id ||
      post.post_id ||
      post.canonical_post_id ||
      ""
  );
  const directLinkedProducts = hasDirectProductLink ? linkedProducts : [];
  const directLinkedProductsCount = hasDirectProductLink
    ? (Number(
      post.linked_products_count ??
        post.product_links_count ??
        metadata.linked_products_count ??
        metadata.product_links_count ??
      linkedProducts.length ??
      0
    ) || directLinkedProducts.length || 0)
    : 0;
  const directPrimaryLinkedProduct = hasDirectProductLink
    ? (post.primary_linked_product || metadata.primary_linked_product || linkedProducts[0] || primaryLinkedProduct || null)
    : null;
  const displayPostTime = clean(
    post.display_post_time ||
      post.created_time ||
      post.post_created_time ||
      post.published_at ||
      metadata.display_post_time ||
      metadata.created_time ||
      metadata.post_created_time ||
      metadata.published_at ||
      metadata.post?.created_time ||
      ""
  );
  const resolvedIdentityId = clean(
    post.id ||
      post.post_id ||
      post.canonical_post_id ||
      post.platform_post_id ||
      post.source_post_id ||
      post.permalink_url ||
      post.post_permalink_url ||
      post.conversation_id ||
      post.session_id ||
      metadata.post_id ||
      metadata.canonical_post_id ||
      metadata.platform_post_id ||
      metadata.source_post_id ||
      metadata.permalink_url ||
      ""
  );
  if (!resolvedIdentityId) {
    console.warn("SOCIAL_CARD_NORMALIZE_REJECT_TRACE", {
      raw_keys: Object.keys(post || {}),
      raw_ids: [
        post.id,
        post.post_id,
        post.canonical_post_id,
        post.platform_post_id,
        post.source_post_id,
        post.permalink_url,
        post.post_permalink_url,
        post.post_link_key,
      ].map((value) => clean(value)).filter(Boolean),
      reject_reason: "missing_identity",
    });
  }
  console.info("SOCIAL_CARD_NORMALIZE_TRACE", {
    post_id: clean(post.post_id || post.id || post.conversation_id || post.session_id || metadata.post_id || ""),
    post_link_key: clean(productLinkKey || post.post_link_key || metadata.post_link_key || ""),
    product_link_source: clean(productLinkSource || "none"),
    has_direct_product_link: Boolean(hasDirectProductLink),
    linked_products_count: linkedProductsCount,
    linked_product_names: linkedProducts.map((item) => clean(item?.name || item?.title || item?.product_name || "")).filter(Boolean),
    display_post_time: displayPostTime,
    raw_time_fields: {
      created_time: clean(post.created_time || metadata.created_time || ""),
      post_created_time: clean(post.post_created_time || metadata.post_created_time || ""),
      published_at: clean(post.published_at || metadata.published_at || ""),
    },
  });
  const mappedProductName = clean(primaryLinkedProduct?.name || primaryLinkedProduct?.title || primaryLinkedProduct?.product_name || "");
  const mappedProductPrice = clean(primaryLinkedProduct?.final_price || primaryLinkedProduct?.sale_price || primaryLinkedProduct?.price || primaryLinkedProduct?.selling_price || "");
  const mappedProductSizes = Array.isArray(primaryLinkedProduct?.available_sizes)
    ? primaryLinkedProduct.available_sizes.join(", ")
    : clean(primaryLinkedProduct?.sizes || "");
  const mappedProductColors = Array.isArray(primaryLinkedProduct?.available_colors)
    ? primaryLinkedProduct.available_colors.join(", ")
    : clean(primaryLinkedProduct?.colors || "");
  const postCreatedTime = clean(
    post.post_created_time ||
      post.marketing_published_at ||
      post.marketing_created_time ||
      metadata.post_created_time ||
      metadata.created_time ||
      metadata.post?.created_time ||
      ""
  );
  return {
    groupKey: clean(post.group_key || post.groupKey || ""),
    group_key: clean(post.group_key || post.groupKey || ""),
    platforms: Array.from(new Set(asArray(post.platforms).map((value) => clean(value).toLowerCase()).filter(Boolean))),
    platformPosts: asArray(post.platformPosts || post.platform_posts),
    id: resolvedIdentityId || clean(post.canonical_post_id || post.final_canonical_post_id || post.platform_post_id || post.post_id || post.id || post.conversation_id || post.session_id || metadata.canonical_post_id || metadata.post_id || post.permalink_url || ""),
    postId: clean(post.canonical_post_id || post.final_canonical_post_id || post.platform_post_id || post.post_id || post.id || metadata.canonical_post_id || metadata.post_id || post.permalink_url || ""),
    sourcePostId: clean(post.post_id || post.id || post.platform_post_id || metadata.post_id || metadata.platform_post_id || ""),
    sourceConversationId: clean(post.conversation_id || post.session_id || post.conversation_key || post.thread_id || metadata.conversation_id || ""),
    platformPostId: clean(post.platform_post_id || metadata.platform_post_id || post.post_id || ""),
    canonicalPostId: clean(post.canonical_post_id || post.final_canonical_post_id || metadata.canonical_post_id || metadata.final_canonical_post_id || post.platform_post_id || post.post_id || ""),
    finalCanonicalPostId: clean(post.final_canonical_post_id || metadata.final_canonical_post_id || post.canonical_post_id || metadata.canonical_post_id || post.platform_post_id || post.post_id || ""),
    conversationId: clean(post.conversation_id || post.session_id || post.conversation_key || post.thread_id || metadata.conversation_id || ""),
    sessionId: clean(post.session_id || metadata.session_id || ""),
    platform: clean(post.platform || metadata.platform || "facebook").toLowerCase(),
    caption: clean(post.caption || post.post_caption || post.post_message || post.message || post.last_message || post.post_text || metadata.post_caption || metadata.post_message || metadata.caption || metadata.message || "منشور بدون نص"),
    thumbnailUrl:
      post.cover_image_url ||
      post.coverImageUrl ||
      post.thumbnailUrl ||
      post.thumbnail_url ||
      post.postThumbnail ||
      post.post_thumbnail ||
      post.postFullPicture ||
      post.post_full_picture ||
      post.attachmentImage ||
      post.attachment_image ||
      post.fullPicture ||
      post.full_picture ||
      post.picture ||
      post.mediaUrl ||
      post.media_url ||
      post.imageUrl ||
      post.image_url ||
      post.image ||
      metadata.thumbnailUrl ||
      metadata.thumbnail_url ||
      metadata.postThumbnail ||
      metadata.post_thumbnail ||
      metadata.postFullPicture ||
      metadata.post_full_picture ||
      metadata.attachmentImage ||
      metadata.attachment_image ||
      metadata.fullPicture ||
      metadata.full_picture ||
      metadata.picture ||
      metadata.mediaUrl ||
      metadata.media_url ||
      metadata.imageUrl ||
      metadata.image_url ||
      metadata.image ||
      metadata.cover_image_url ||
      metadata.coverImageUrl ||
      attachmentImage ||
      post.product_image_url ||
      post.product_image ||
      null,
    permalinkUrl: clean(post.permalink_url || post.display_permalink || post.post_permalink || post.post_permalink_url || post.post_url || metadata.permalink_url || metadata.display_permalink || metadata.post_permalink || metadata.post_permalink_url || metadata.post_url || ""),
    permalink_url: clean(post.permalink_url || post.display_permalink || post.post_permalink || post.post_permalink_url || post.post_url || metadata.permalink_url || metadata.display_permalink || metadata.post_permalink || metadata.post_permalink_url || metadata.post_url || ""),
    display_permalink: clean(post.display_permalink || post.permalink_url || post.post_permalink || post.post_permalink_url || metadata.display_permalink || metadata.permalink_url || metadata.post_permalink || metadata.post_permalink_url || ""),
    post_permalink: clean(post.post_permalink || post.post_permalink_url || post.permalink_url || metadata.post_permalink || metadata.post_permalink_url || metadata.permalink_url || ""),
    commentsCount: Number(post.commentsCount ?? post.comments_count ?? post.comment_count ?? post.total_comments ?? metadata.comments_count ?? 0),
    newCount: Number(post.newCount ?? post.new_comments_count ?? post.unread_comments_count ?? metadata.new_comments_count ?? 0),
    likesCount: Number(post.likes_count || post.like_count || post.reactions_count || post.total_likes || metadata.likes_count || metadata.like_count || metadata.reactions_count || metadata.total_likes || 0) || 0,
    sharesCount: Number(post.shares_count || post.share_count || metadata.shares_count || metadata.share_count || 0) || 0,
    publishedAt: clean(postCreatedTime || post.published_at || post.created_time || post.created_at || post.posted_at || metadata.published_at || metadata.created_time || metadata.created_at || metadata.posted_at || ""),
    lastActivity: clean(post.last_activity_at || post.last_comment_at || post.last_message_at || post.updated_at || post.created_at || metadata.last_activity_at || ""),
    autoReplyEnabled: Boolean(post.auto_reply_enabled || post.template_enabled || post.auto_reply_mode || metadata.auto_reply_enabled || metadata.template_enabled || metadata.auto_reply_mode),
    productName: clean(post.product_name || post.product_title || metadata.product_name || metadata.product_title || mappingSummary.primary_product_name || mappedProductName || ""),
    productId: clean(post.product_id || metadata.product_id || primaryLinkedProduct?.id || primaryLinkedProduct?.product_id || ""),
    product_id: clean(post.product_id || metadata.product_id || primaryLinkedProduct?.id || primaryLinkedProduct?.product_id || ""),
    productLinkIdentity: productLinkIdentity,
    product_link_identity: productLinkIdentity,
    productLinkKey,
    product_link_key: productLinkKey,
    platform_post_id: clean(post.platform_post_id || metadata.platform_post_id || post.post_id || ""),
    source_post_id: clean(post.source_post_id || metadata.source_post_id || post.post_id || ""),
    permalink_url: clean(post.permalink_url || post.post_permalink_url || metadata.permalink_url || metadata.post_permalink_url || ""),
    productPrice: clean(post.product_price || metadata.product_price || mappedProductPrice || ""),
    productSalePrice: clean(post.product_sale_price || metadata.product_sale_price || clean(primaryLinkedProduct?.sale_price || "")),
    productSizes: clean(post.product_sizes || metadata.product_sizes || mappedProductSizes || ""),
    productColors: clean(post.product_colors || metadata.product_colors || mappedProductColors || ""),
    productStock: clean(post.product_stock || metadata.product_stock || primaryLinkedProduct?.stock || primaryLinkedProduct?.total_stock || ""),
    productVariantCount: clean(post.product_variant_count || metadata.product_variant_count || linkedProductsCount || ""),
    productLink: clean(post.product_link || post.product_storefront_url || post.product_url || metadata.product_link || metadata.product_storefront_url || metadata.product_url || primaryLinkedProduct?.product_url || ""),
    storeAddress: clean(post.store_address || metadata.store_address || ""),
    shippingTime: clean(post.shipping_time || metadata.shipping_time || ""),
    postCreatedTime,
    post_created_time: postCreatedTime,
    displayPostTime,
    display_post_time: displayPostTime,
    realCommentCreatedTime: clean(post.real_comment_created_time || metadata.real_comment_created_time || ""),
    real_comment_created_time: clean(post.real_comment_created_time || metadata.real_comment_created_time || ""),
    commentCreatedTime: clean(post.comment_created_time || metadata.comment_created_time || ""),
    comment_created_time: clean(post.comment_created_time || metadata.comment_created_time || ""),
    linkedProductsCount,
    linked_products_count: linkedProductsCount,
    linkedProducts,
    linked_products: linkedProducts,
    directLinkedProductsCount,
    direct_linked_products_count: directLinkedProductsCount,
    directLinkedProducts,
    direct_linked_products: directLinkedProducts,
    primaryLinkedProduct,
    primary_linked_product: primaryLinkedProduct,
    directPrimaryLinkedProduct,
    direct_primary_linked_product: directPrimaryLinkedProduct,
    productLinkSource,
    product_link_source: productLinkSource,
    hasDirectProductLink,
    has_direct_product_link: hasDirectProductLink,
    hasSiblingProductContext,
    has_sibling_product_context: hasSiblingProductContext,
    selected_post_identity: post.selected_post_identity || metadata.selected_post_identity || null,
    latest_comment_post_identity: post.latest_comment_post_identity || metadata.latest_comment_post_identity || null,
    permalinkPostId: clean(post.permalink_post_id || metadata.permalink_post_id || ""),
    permalink_post_id: clean(post.permalink_post_id || metadata.permalink_post_id || ""),
    post_identity_mismatch: Boolean(post.post_identity_mismatch ?? metadata.post_identity_mismatch),
    post_identity_mismatch_reason: clean(post.post_identity_mismatch_reason || metadata.post_identity_mismatch_reason || ""),
    mapping_summary: mappingSummary,
    duplicateIdentity: post.duplicate_identity || metadata.duplicate_identity || null,
    duplicatePostIds: Array.isArray(post.compared_post_ids) ? post.compared_post_ids : Array.isArray(metadata.compared_post_ids) ? metadata.compared_post_ids : [],
    duplicateRowIds: Array.isArray(post.compared_row_ids) ? post.compared_row_ids : Array.isArray(metadata.compared_row_ids) ? metadata.compared_row_ids : [],
    attachmentImage,
    raw: post,
  };
};

function normalizeSocialPostDisplay(raw = {}) {
  const normalized = normalizePost(raw);
  const post = normalized.raw && typeof normalized.raw === "object" ? normalized.raw : raw || {};
  const metadata = post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const displayTextCandidates = [
    post.post_text,
    post.message,
    post.caption,
    post.text,
    post.description,
    post.post_caption,
    post.post_message,
    post.last_message,
    metadata.post_text,
    metadata.message,
    metadata.caption,
    metadata.text,
    metadata.description,
    metadata.post_caption,
    metadata.post_message,
    normalized.caption,
  ]
    .map(clean)
    .filter(Boolean)
    .filter((value) => value !== "منشور بدون نص");
  const displayImageCandidates = [
    post.post_image_url,
    post.media_url,
    post.full_picture,
    post.post_full_picture,
    post.picture,
    post.image_url,
    post.image,
    post.thumbnail_url,
    post.thumbnailUrl,
    post.post_thumbnail,
    post.postThumbnail,
    metadata.post_image_url,
    metadata.media_url,
    metadata.full_picture,
    metadata.post_full_picture,
    metadata.picture,
    metadata.image_url,
    metadata.image,
    metadata.thumbnail_url,
    metadata.post_thumbnail,
    normalized.thumbnailUrl,
  ]
    .map(clean)
    .filter(Boolean);
  const displayPermalinkCandidates = [
    post.permalink_url,
    post.post_permalink_url,
    post.post_permalink,
    post.post_url,
    metadata.permalink_url,
    metadata.post_permalink_url,
    metadata.post_permalink,
    metadata.post_url,
    normalized.permalinkUrl,
  ]
    .map(clean)
    .filter(Boolean);
  const displayCreatedAtCandidates = [
    post.created_at,
    post.created_time,
    post.post_created_time,
    post.published_at,
    post.publishedAt,
    post.marketing_published_at,
    post.marketing_created_time,
    metadata.created_at,
    metadata.created_time,
    metadata.post_created_time,
    metadata.published_at,
    metadata.post?.created_time,
    normalized.postCreatedTime,
    normalized.publishedAt,
  ]
    .map(clean)
    .filter(Boolean);
  return {
    ...normalized,
    displayText: displayTextCandidates[0] || "",
    displayImage: displayImageCandidates[0] || "",
    displayPermalink: displayPermalinkCandidates[0] || "",
    displayCreatedAt: displayCreatedAtCandidates[0] || "",
    displayCommentCount: Number(
      post.comments_count ||
        post.comment_count ||
        post.total_comments ||
        metadata.comments_count ||
        metadata.comment_count ||
        metadata.total_comments ||
        normalized.commentsCount ||
        0
    ) || 0,
  };
}

const postKey = (item = {}) => {
  const platform = clean(item?.platform || "facebook");
  const productLinkIdentity = item?.product_link_identity && typeof item.product_link_identity === "object" && !Array.isArray(item.product_link_identity)
    ? item.product_link_identity
    : item?.post_identity && typeof item.post_identity === "object" && !Array.isArray(item.post_identity)
      ? item.post_identity
      : {};
  const resolvedProductLinkKey = clean(
    item?.post_link_key ||
      item?.postLinkKey ||
      productLinkIdentity.product_link_key ||
      productLinkIdentity.post_id ||
      productLinkIdentity.canonical_post_id ||
      ""
  );
  const platformPostId = clean(item?.platformPostId || item?.platform_post_id || "");
  const sourcePostId = clean(item?.sourcePostId || item?.source_post_id || item?.postId || item?.post_id || "");
  const permalinkPostId = clean(item?.permalinkPostId || item?.permalink_post_id || "");
  const canonicalPostId = clean(item?.canonicalPostId || item?.canonical_post_id || item?.finalCanonicalPostId || item?.final_canonical_post_id || "");
  if (resolvedProductLinkKey) return resolvedProductLinkKey;
  const composite = [platform, platformPostId, sourcePostId, permalinkPostId, canonicalPostId].join("|");
  if (platformPostId || sourcePostId || permalinkPostId || canonicalPostId) return composite;
  return clean(item?.display_permalink || item?.permalinkUrl || item?.postId || item?.id || "");
};

const postSelectionKey = (item = {}) =>
  clean(
    item?.post_link_key ||
      item?.postLinkKey ||
      item?.platform_post_id ||
      item?.platformPostId ||
      item?.source_post_id ||
      item?.sourcePostId ||
      item?.post_id ||
      item?.postId ||
      item?.id ||
      item?.permalink_url ||
      item?.permalinkUrl ||
      ""
  );

const parseCompositePostIdentityKey = (value = "") => {
  const raw = clean(value);
  if (!raw || !raw.includes("|")) {
    return {
      platform: "",
      platformPostId: raw,
      sourcePostId: raw,
      permalinkPostId: "",
      canonicalPostId: raw,
      resolvedPostId: raw,
    };
  }
  const [platform = "", platformPostId = "", thirdPart = "", permalinkPostId = "", fifthPart = ""] = raw.split("|").map(clean);
  const canonicalPostId = clean(thirdPart || fifthPart || platformPostId);
  const sourcePostId = clean(fifthPart || thirdPart || platformPostId);
  return {
    platform,
    platformPostId: clean(platformPostId),
    sourcePostId,
    permalinkPostId: clean(permalinkPostId),
    canonicalPostId,
    resolvedPostId: clean(canonicalPostId || sourcePostId || platformPostId || permalinkPostId),
  };
};

const automationRoutePostId = (item = {}, fallbackKey = "") => {
  const directCanonicalPostId = clean(
    item?.canonicalPostId ||
    item?.canonical_post_id ||
    item?.finalCanonicalPostId ||
    item?.final_canonical_post_id ||
    ""
  );
  if (directCanonicalPostId) return directCanonicalPostId;
  const parsedFallback = parseCompositePostIdentityKey(fallbackKey);
  return clean(
    parsedFallback.canonicalPostId ||
    item?.postId ||
    item?.post_id ||
    parsedFallback.sourcePostId ||
    parsedFallback.platformPostId ||
    fallbackKey
  );
};

const postIdentityFingerprint = (item = {}) =>
  [
    clean(item?.platform || ""),
    clean(item?.platformPostId || ""),
    clean(item?.sourcePostId || ""),
    clean(item?.canonicalPostId || item?.finalCanonicalPostId || ""),
    clean(item?.permalinkUrl || item?.display_permalink || ""),
  ].join("|");

const extractPermalinkPostId = (value = "") => {
  const permalink = clean(value);
  if (!permalink) return "";
  const patterns = [
    /facebook\.com\/[^/]+\/posts\/(\d+)/i,
    /facebook\.com\/[^/]+\/videos\/(\d+)/i,
    /facebook\.com\/photo\.php\?(?:[^#&]*&)*fbid=(\d+)/i,
    /facebook\.com\/permalink\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
    /facebook\.com\/story\.php\?(?:[^#&]*&)*story_fbid=(\d+)/i,
    /facebook\.com\/watch\/\?v=(\d+)/i,
  ];
  for (const pattern of patterns) {
    const match = permalink.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return "";
};

const buildPostIdentitySnapshot = (post = {}) => {
  const normalized = normalizePost(post || {});
  const metadata = normalized?.metadata && typeof normalized.metadata === "object" && !Array.isArray(normalized.metadata) ? normalized.metadata : {};
  const raw = normalized?.raw && typeof normalized.raw === "object" && !Array.isArray(normalized.raw) ? normalized.raw : {};
  const selectedIdentity = post?.selected_post_identity && typeof post.selected_post_identity === "object" && !Array.isArray(post.selected_post_identity)
    ? post.selected_post_identity
    : normalized?.raw?.selected_post_identity && typeof normalized.raw.selected_post_identity === "object" && !Array.isArray(normalized.raw.selected_post_identity)
      ? normalized.raw.selected_post_identity
      : {};
  const permalink = clean(
    selectedIdentity?.permalink_url ||
    normalized?.permalinkUrl ||
    normalized?.display_permalink ||
    normalized?.post_permalink ||
    raw?.permalink_url ||
    metadata?.permalink_url ||
    ""
  );
  const permalinkPostId = clean(
    selectedIdentity?.permalink_post_id ||
    raw?.permalink_post_id ||
    extractPermalinkPostId(permalink)
  );
  const ids = new Set(
    [
      post?.post_link_key,
      post?.postLinkKey,
      post?.product_link_identity?.product_link_key,
      post?.product_link_identity?.post_id,
      post?.post_identity?.product_link_key,
      post?.post_identity?.post_id,
      normalized?.canonicalPostId,
      normalized?.finalCanonicalPostId,
      normalized?.platformPostId,
      normalized?.sourcePostId,
      normalized?.postId,
      raw?.post_id,
      raw?.platform_post_id,
      raw?.source_post_id,
      metadata?.post_id,
      metadata?.platform_post_id,
      metadata?.source_post_id,
      selectedIdentity?.canonical_post_id,
      selectedIdentity?.platform_post_id,
      selectedIdentity?.source_post_id,
      selectedIdentity?.post_id,
      selectedIdentity?.object_id,
      permalinkPostId,
    ]
      .map((value) => clean(value))
      .filter(Boolean)
      .flatMap((value) => (value.includes("_") ? [value, clean(value.split("_").pop() || "")] : [value]))
  );
  return {
    normalized,
    permalink,
    permalinkPostId,
    ids,
  };
};

const comparePostIdentitySnapshots = (left = null, right = null) => {
  const leftSnapshot = left?.ids ? left : buildPostIdentitySnapshot(left || {});
  const rightSnapshot = right?.ids ? right : buildPostIdentitySnapshot(right || {});
  const leftSelectionKey = postSelectionKey(left?.normalized || left || {});
  const rightSelectionKey = postSelectionKey(right?.normalized || right || {});
  if (leftSelectionKey && rightSelectionKey && leftSelectionKey !== rightSelectionKey) {
    return { matches: false, reason: "post_link_key_mismatch", shared: [] };
  }
  if (leftSelectionKey && rightSelectionKey && leftSelectionKey === rightSelectionKey) {
    return { matches: true, reason: "", shared: [leftSelectionKey] };
  }
  const shared = Array.from(leftSnapshot.ids || []).filter((value) => rightSnapshot.ids?.has(value));
  if (!leftSnapshot.ids?.size || !rightSnapshot.ids?.size) {
    return { matches: false, reason: "missing_identity" };
  }
  if (shared.length) {
    return { matches: true, reason: "", shared };
  }
  if (leftSnapshot.permalinkPostId && rightSnapshot.permalinkPostId && leftSnapshot.permalinkPostId !== rightSnapshot.permalinkPostId) {
    return { matches: false, reason: "permalink_post_id_mismatch", shared: [] };
  }
  return { matches: false, reason: "identity_values_disagree", shared: [] };
};

const findMatchingNormalizedPost = (items = [], target = null) => {
  const normalizedTarget = normalizePost(target || {});
  const targetSelectionKey = postSelectionKey(normalizedTarget);
  const targetKey = postKey(normalizedTarget);
  const targetSnapshot = buildPostIdentitySnapshot(normalizedTarget);
  const list = Array.isArray(items) ? items : [];
  if (targetSelectionKey) {
    const exactSelection = list.find((item) => postSelectionKey(item) === targetSelectionKey);
    if (exactSelection) return exactSelection;
    return normalizedTarget;
  }
  if (targetSnapshot.ids.size) {
    const exact = list.find((item) => comparePostIdentitySnapshots(item, targetSnapshot).matches);
    if (exact) return exact;
  }
  if (targetKey) {
    const keyed = list.find((item) => postKey(item) === targetKey);
    if (keyed) return keyed;
  }
  return normalizedTarget;
};

const commentKey = (item = {}) => clean(item?.id || "");

const platformMeta = (platform = "") => {
  const key = clean(platform).toLowerCase();
  if (key.includes("instagram")) return { label: "Instagram", className: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
  return { label: "Facebook", className: "border-cyan-300/20 bg-cyan-400/10 text-cyan-100" };
};

const postTypeMeta = (post = {}) => {
  const rawType = clean(post?.raw?.post_type || post?.raw?.type || post?.raw?.story_type || post?.raw?.content_type || post?.metadata?.post_type || post?.metadata?.type || "");
  if (!rawType) return null;
  const key = rawType.toLowerCase();
  const label = key.includes("reel")
    ? "Reel"
    : key.includes("carousel")
      ? "Carousel"
      : key.includes("video")
        ? "Video"
        : key.includes("story")
          ? "Text"
          : key.includes("photo") || key.includes("image")
            ? "Photo"
            : key.includes("text")
              ? "Text"
              : rawType;
  if (!label) return null;
  const styles = {
    Reel: "border-fuchsia-300/20 bg-fuchsia-400/10 text-fuchsia-100",
    Photo: "border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
    Video: "border-sky-300/20 bg-sky-400/10 text-sky-100",
    Carousel: "border-violet-300/20 bg-violet-400/10 text-violet-100",
    Text: "border-amber-300/20 bg-amber-400/10 text-amber-100",
  };
  return { label, className: styles[label] || "border-white/10 bg-white/[0.04] text-slate-200" };
};

const getAttachmentImage = (post = {}) => {
  const attachments = Array.isArray(post.attachments?.data)
    ? post.attachments.data
    : Array.isArray(post.attachments)
      ? post.attachments
      : Array.isArray(post.attachment?.data)
        ? post.attachment.data
        : Array.isArray(post.attachment)
          ? post.attachment
          : [];
  for (const attachment of attachments) {
    const image =
      attachment?.media?.image?.src ||
      attachment?.media?.image_url ||
      attachment?.media?.source ||
      attachment?.subattachments?.data?.[0]?.media?.image?.src ||
      attachment?.subattachments?.data?.[0]?.media?.image_url ||
      attachment?.subattachments?.[0]?.media?.image?.src ||
      attachment?.subattachments?.[0]?.media?.image_url ||
      "";
    if (clean(image)) return clean(image);
  }
  return "";
};

const getCommentAttachmentImage = (comment = {}) => {
  const raw = comment && typeof comment === "object" ? comment : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const directCandidates = [
    raw.attachment_image,
    raw.attachment_url,
    raw.media_url,
    raw.media_image_url,
    raw.image_url,
    raw.picture,
    raw.thumbnail_url,
    metadata.attachment_image,
    metadata.attachment_url,
    metadata.media_url,
    metadata.media_image_url,
    metadata.image_url,
    metadata.picture,
    metadata.thumbnail_url,
  ];
  for (const candidate of directCandidates) {
    if (clean(candidate)) return clean(candidate);
  }

  const attachments = Array.isArray(raw.attachments?.data)
    ? raw.attachments.data
    : Array.isArray(raw.attachments)
      ? raw.attachments
      : Array.isArray(raw.attachment?.data)
        ? raw.attachment.data
        : Array.isArray(raw.attachment)
          ? raw.attachment
          : [];
  for (const attachment of attachments) {
    const image =
      attachment?.media?.image?.src ||
      attachment?.media?.image_url ||
      attachment?.media?.source ||
      attachment?.subattachments?.data?.[0]?.media?.image?.src ||
      attachment?.subattachments?.data?.[0]?.media?.image_url ||
      attachment?.subattachments?.[0]?.media?.image?.src ||
      attachment?.subattachments?.[0]?.media?.image_url ||
      "";
    if (clean(image)) return clean(image);
  }
  return "";
};

const getPostImage = (post = {}) => clean(normalizePost(post).thumbnailUrl || "");

const getPostCaption = (post = {}) => clean(normalizePost(post).caption);

const getCommentClassification = (comment) => normalizeComment(comment).classification || "Question";

const getCommentText = (comment = {}) => normalizeComment(comment).message;

const classifyComment = (comment = {}) => clean(getCommentClassification(comment) || "pending");

const labelText = (value = "") => {
  const key = clean(value).toLowerCase();
  if (key === "lead_price") return "Price";
  if (key === "lead_size") return "Size";
  if (key === "lead_shipping") return "Shipping";
  if (key === "lead_details") return "Question";
  if (key === "lead_inbox") return "Lead";
  if (key === "human_review") return "Review";
  if (key === "ignore" || key === "engagement_only") return "Spam";
  if (key === "sent") return "Replied";
  if (key === "failed") return "Failed";
  if (key === "pending") return "Pending";
  return value ? value.replace(/_/g, " ") : "—";
};

const summaryBucketLabel = (comment = {}) => {
  const normalized = normalizeComment(comment);
  const classification = clean(normalized.classification).toLowerCase();
  const text = normalized.message;
  const haystack = `${classification} ${text}`.toLowerCase();
  if (classification === "lead_price" || /(price|سعر|ثمن|كام|بكام)/i.test(haystack)) return "price";
  if (classification === "lead_size" || /(size|مقاس|المقاس)/i.test(haystack)) return "size";
  if (classification === "lead_shipping" || /(shipping|شحن|توصيل)/i.test(haystack)) return "shipping";
  if (classification === "lead_details" || /(details|تفاصيل|معلومات)/i.test(haystack)) return "details";
  if (classification === "lead_inbox" || /(جاهز|buy|order|عاوز|عايزة|اريد|أريد|طلب)/i.test(haystack)) return "ready";
  if (classification === "ignore" || classification === "engagement_only") return "spam";
  return "question";
};

const getCommentTags = (comment = {}) => {
  const tags = new Set();
  const bucket = summaryBucketLabel(comment);
  const normalized = normalizeComment(comment);
  if (bucket === "price") tags.add("Price");
  if (bucket === "size") tags.add("Size");
  if (bucket === "shipping") tags.add("Shipping");
  if (bucket === "details" || bucket === "question") tags.add("Question");
  if (bucket === "ready") tags.add("Lead");
  if (bucket === "spam") tags.add("Spam");
  if (clean(normalized.classification).toLowerCase() === "human_review") tags.add("Review");
  if (clean(normalized.classification).toLowerCase() === "lead_inbox") tags.add("Lead");
  return Array.from(tags).slice(0, 4);
};

const templatePreviewText = (template = {}, context = {}) => {
  const raw = clean(template.template || template.text || "");
  if (!raw) return "";
  return raw.replace(/\{\{\s*(\w+)\s*\}\}|\{\s*(\w+)\s*\}/g, (_match, leftKey, rightKey) => {
    const key = (leftKey || rightKey || "").toLowerCase();
    return clean(context[key] ?? context[key.replace(/_([a-z])/g, (_m, letter) => letter.toUpperCase())] ?? "");
  });
};

function selectFirst(...values) {
  return values.map((value) => clean(value)).find(Boolean) || "";
}
const dash = "—";

function resolveFirstField(...values) {
  return clean(values.map((value) => clean(value)).find(Boolean) || "");
}

const resolveProductCardFields = (post = {}) => {
  const metadata = post?.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const mappingSummary = post?.mapping_summary && typeof post.mapping_summary === "object" && !Array.isArray(post.mapping_summary) ? post.mapping_summary : {};
  const linkedProducts = Array.isArray(post?.linked_products) ? post.linked_products : [];
  const primary = post?.primary_linked_product || post?.primary_product || linkedProducts[0] || mappingSummary.primary_product || null;
  const productName = clean(
    post?.productName ||
      post?.product_name ||
      primary?.name ||
      primary?.title ||
      primary?.product_name ||
      metadata.product_name ||
      metadata.product_title ||
      mappingSummary.primary_product_name ||
      ""
  );
  const productBrand = clean(
    primary?.brand ||
      primary?.brand_name ||
      primary?.vendor ||
      post?.product_brand ||
      post?.brand ||
      metadata.product_brand ||
      metadata.brand ||
      ""
  );
  const priceValue = resolveFirstField(
    post?.productPrice,
    post?.product_price,
    primary?.final_price,
    primary?.sale_price,
    primary?.price,
    primary?.selling_price,
    metadata.product_price
  );
  const salePriceValue = resolveFirstField(
    post?.productSalePrice,
    post?.product_sale_price,
    primary?.sale_price,
    primary?.final_price,
    metadata.product_sale_price
  );
  const stockValue = resolveFirstField(
    post?.productStock,
    post?.product_stock,
    primary?.total_stock,
    primary?.available_stock,
    primary?.stock,
    primary?.stock_status,
    metadata.product_stock
  );
  const sizesValue = resolveFirstField(
    post?.productSizes,
    post?.product_sizes,
    Array.isArray(primary?.available_sizes) ? primary.available_sizes.join(", ") : "",
    primary?.sizes,
    metadata.product_sizes
  );
  const colorsValue = resolveFirstField(
    post?.productColors,
    post?.product_colors,
    Array.isArray(primary?.available_colors) ? primary.available_colors.join(", ") : "",
    primary?.colors,
    metadata.product_colors
  );
  const productLink = resolveFirstField(
    post?.productLink,
    post?.product_storefront_url,
    post?.product_url,
    primary?.product_url,
    primary?.storefront_url,
    primary?.storefrontUrl,
    metadata.product_link,
    metadata.product_storefront_url,
    metadata.product_url
  );
  const productImage = resolveFirstField(
    primary?.image_url,
    primary?.image,
    primary?.thumbnail_url,
    post?.product_image_url,
    post?.product_image,
    metadata.product_image_url,
    metadata.product_image
  );
  const productCount = Number(
    post?.linkedProductsCount ??
      post?.linked_products_count ??
      post?.product_links_count ??
      metadata.linked_products_count ??
      metadata.product_links_count ??
      linkedProducts.length ??
      0
  ) || 0;
  return {
    productName,
    productBrand,
    priceValue,
    salePriceValue,
    stockValue,
    sizesValue,
    colorsValue,
    productLink,
    productImage,
    productCount,
    primary,
  };
};

const resolveAutomationStateLabel = ({ post = {}, config = null, productCount = 0 } = {}) => {
  const hasProduct = Number(productCount) > 0;
  const normalizedConfig = config && typeof config === "object" ? config : null;
  const configId = clean(normalizedConfig?.config_id || normalizedConfig?.id || post?.automation_config_id || post?.config_id || "");
  const enabledValue = normalizedConfig?.enabled ?? post?.auto_reply_enabled ?? post?.template_enabled ?? post?.autoReplyEnabled ?? false;
  if (!hasProduct) {
    return {
      labelKey: "aiSupport.inbox.socialWorkspace.linkProductRequired",
      tone: "amber",
      configId,
      enabled: Boolean(enabledValue),
      hintKey: "aiSupport.inbox.socialWorkspace.noLinkedProduct",
    };
  }
  if (configId && Boolean(enabledValue)) {
    return {
      labelKey: "aiSupport.inbox.socialWorkspace.automationEnabled",
      tone: "emerald",
      configId,
      enabled: true,
      hintKey: "aiSupport.inbox.socialWorkspace.configActive",
    };
  }
  if (configId) {
    return {
      labelKey: "aiSupport.inbox.socialWorkspace.automationDisabled",
      tone: "slate",
      configId,
      enabled: false,
      hintKey: "aiSupport.inbox.socialWorkspace.configSaved",
    };
  }
  return {
    labelKey: "aiSupport.inbox.socialWorkspace.ready",
    tone: "cyan",
    configId,
    enabled: Boolean(enabledValue),
    hintKey: "aiSupport.inbox.socialWorkspace.productLinked",
  };
}

const automationToneClass = (tone = "slate") => {
  if (tone === "emerald" || tone === "success") return "border-emerald-300/20 bg-emerald-400/10 text-emerald-800";
  if (tone === "amber" || tone === "pending") return "border-amber-300/20 bg-amber-50 text-amber-800";
  if (tone === "failed") return "border-rose-300/20 bg-rose-50 text-rose-800";
  if (tone === "cyan") return "border-cyan-300/20 bg-cyan-50 text-cyan-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
};

const normalizeAutomationRuntimeTone = (value = "") => {
  const key = clean(value).toLowerCase().replace(/\s+/g, "_");
  if (["success", "sent", "done", "completed", "delivered", "ok", "applied"].includes(key)) return "success";
  if (["pending", "queued", "running", "processing", "review"].includes(key)) return "pending";
  if (["failed", "error", "blocked", "rejected"].includes(key)) return "failed";
  return "slate";
};

const resolvePostOpenLink = (post = {}, display = {}) => {
  const metadata = post?.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const raw = post?.raw && typeof post.raw === "object" && !Array.isArray(post.raw) ? post.raw : {};
  const candidates = [
    { source: "permalink_url", value: post?.permalink_url },
    { source: "display_permalink", value: post?.display_permalink },
    { source: "post_permalink", value: post?.post_permalink },
    { source: "metadata.permalink_url", value: metadata?.permalink_url },
    { source: "graph permalink_url", value: post?.facebook_permalink || post?.permalinkUrl || post?.post_permalink_url },
    { source: "raw.permalink_url", value: raw?.permalink_url },
    { source: "displayPermalink", value: display?.displayPermalink },
  ];
  const resolved = candidates
    .map((item) => ({ ...item, value: normalizeExternalSocialUrl(item.value) }))
    .find((item) => item.value) || null;
  const fallbackPermalink = buildCanonicalSocialPostUrl(post);
  const canonicalPostId = clean(post?.canonicalPostId || post?.canonical_post_id || post?.postId || post?.id || "");
  const activeAliasId = clean(post?.sourcePostId || post?.platformPostId || post?.platform_post_id || raw?.post_id || raw?.id || "");
  return {
    resolvedPermalink: resolved?.value || "",
    fallbackPermalink,
    finalUrl: resolved?.value || fallbackPermalink,
    sourceField: resolved?.source || (fallbackPermalink ? "platform_post_id_fallback" : ""),
    canonicalPostId,
    activeAliasId,
    hasPermalink: Boolean(resolved?.value || fallbackPermalink),
    usedFallback: !resolved?.value && Boolean(fallbackPermalink),
  };
};

const initialsFromName = (value = "") => {
  const parts = clean(value)
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return "";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
};

const resolveCommentCustomerName = (comment = {}) => {
  const normalized = normalizeComment(comment);
  const raw = comment && typeof comment === "object" ? comment.raw || comment : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  return clean(
    normalized.customerName ||
      raw.customer_name ||
      raw.commenter_name ||
      raw.from?.name ||
      metadata.customer_name ||
      metadata.commenter_name ||
      metadata.from?.name ||
      "عميل"
  );
};

const resolveCommentCustomerAvatar = (comment = {}) => {
  const normalized = normalizeComment(comment);
  const raw = comment && typeof comment === "object" ? comment.raw || comment : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  return clean(
    normalized.customerAvatar ||
      raw.customer_avatar_url ||
      raw.commenter_profile_picture_url ||
      pictureUrlFrom(raw.from?.picture) ||
      raw.profile_pic_url ||
      raw.profile_picture_url ||
      raw.customer_avatar ||
      raw.avatar ||
      raw.avatar_url ||
      raw.profile_pic ||
      metadata.customer_avatar_url ||
      metadata.customer_avatar ||
      metadata.commenter_profile_picture_url ||
      pictureUrlFrom(metadata.from?.picture) ||
      metadata.profile_pic_url ||
      metadata.profile_picture_url ||
      metadata.avatar ||
      metadata.avatar_url ||
      metadata.profile_pic ||
      ""
  );
};

const supportsPrivateMessage = (comment = {}, fallbackPlatform = "") => {
  const channel = clean(comment?.platform || comment?.raw?.platform || fallbackPlatform).toLowerCase();
  return channel.includes("facebook") || channel.includes("instagram");
};

const resolveCommentPlatformLabel = (comment = {}) => {
  const normalized = normalizeComment(comment);
  const raw = comment && typeof comment === "object" ? comment.raw || comment : {};
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const platform = clean(normalized.platform || raw.platform || metadata.platform || "").toLowerCase();
  if (platform.includes("instagram")) return "Instagram";
  if (platform.includes("facebook")) return "Facebook";
  return platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Facebook";
};

const resolvePostMediaBadge = (post = {}) => {
  const rawType = clean(post?.raw?.post_type || post?.raw?.type || post?.raw?.story_type || post?.raw?.content_type || post?.metadata?.post_type || post?.metadata?.type || post?.metadata?.content_type || "");
  const key = rawType.toLowerCase();
  const hasImage = Boolean(clean(
    post?.displayImage ||
      post?.thumbnailUrl ||
      post?.thumbnail_url ||
      post?.raw?.full_picture ||
      post?.raw?.post_full_picture ||
      post?.raw?.media_url ||
      post?.raw?.image_url ||
      post?.metadata?.full_picture ||
      post?.metadata?.post_full_picture ||
      post?.metadata?.media_url ||
      post?.metadata?.image_url ||
      post?.metadata?.thumbnail_url ||
      ""
  ));
  const label = key.includes("reel")
    ? "Reel"
    : key.includes("carousel")
      ? "Carousel"
      : key.includes("video")
        ? "Video"
        : hasImage && !key.includes("video") && !key.includes("reel")
          ? "Photo"
          : key.includes("photo") || key.includes("image")
            ? "Photo"
            : key.includes("text")
              ? "Text"
              : key.includes("story")
              ? "Text"
              : "";
  if (!label) return null;
  const styles = {
    Reel: "border-fuchsia-300/20 bg-fuchsia-400/15 text-fuchsia-100",
    Photo: "border-emerald-300/20 bg-emerald-400/15 text-emerald-100",
    Video: "border-sky-300/20 bg-sky-400/15 text-sky-100",
    Carousel: "border-violet-300/20 bg-violet-400/15 text-violet-100",
    Text: "border-amber-300/20 bg-amber-400/15 text-amber-100",
  };
  return { label, className: styles[label] || "border-white/10 bg-white/[0.04] text-slate-200" };
};

const stripTrailingParagraphBreaks = (value = "") => clean(value).replace(/\n{3,}/g, "\n\n");
const getPostLinkedProducts = (post = {}) => {
  const metadata = post?.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const mappingSummary = post?.mapping_summary && typeof post.mapping_summary === "object" && !Array.isArray(post.mapping_summary) ? post.mapping_summary : {};
  const linkedProducts = Array.isArray(post?.linked_products)
    ? post.linked_products
    : Array.isArray(metadata.linked_products)
      ? metadata.linked_products
      : Array.isArray(mappingSummary.linked_products)
        ? mappingSummary.linked_products
        : [];
  const primaryLinkedProduct =
    post?.primary_linked_product ||
    post?.primary_product ||
    metadata.primary_linked_product ||
    metadata.primary_product ||
    mappingSummary.primary_linked_product ||
    mappingSummary.primary_product ||
    linkedProducts[0] ||
    null;
  return {
    linkedProducts,
    linkedProductsCount: Number(
      post?.linked_products_count ??
        post?.product_links_count ??
        metadata.linked_products_count ??
        metadata.product_links_count ??
        mappingSummary.count ??
        linkedProducts.length ??
        0
    ) || 0,
    primaryLinkedProduct,
    primaryProductName: clean(primaryLinkedProduct?.name || primaryLinkedProduct?.title || primaryLinkedProduct?.product_name || ""),
  };
};

const SocialCommentsWorkspaceCommentRow = memo(function SocialCommentsWorkspaceCommentRow({
  comment = {},
  selectedCommentKey = "",
  highlightedCommentKey = "",
  activePostPlatform = "facebook",
  replyDraft = "",
  previewReply = "",
  suggestedReply = "",
  replyLoadingKey = "",
  likeLoadingKey = "",
  likeStatus = "",
  privateMessageLoadingKey = "",
  privateMessageStatus = "",
  leadLoadingKey = "",
  ignoreLoadingKey = "",
  onSelectComment,
  onSelectCustomer,
  onLike,
  onCompose,
  onReply,
  onPrivateMessage,
  registerCommentNode,
}) {
  const { t } = useTranslation();
  const key = clean(comment.comment_id || comment.external_comment_id || comment.id || "");
  const actionKey = resolveSocialCommentActionId(comment) || key;
  const attachmentPreview = getCommentAttachmentImage(comment.raw || comment);
  const busy = Boolean(likeLoadingKey === actionKey || replyLoadingKey === actionKey || privateMessageLoadingKey === actionKey || leadLoadingKey === key || ignoreLoadingKey === key);
  const privateMessageSupported = supportsPrivateMessage(comment, activePostPlatform);
  const isHighlighted = highlightedCommentKey === key;
  const nextReplyText = clean(replyDraft || previewReply || suggestedReply);
  const handleSelect = useCallback(() => onSelectComment?.(key), [key, onSelectComment]);
  const handleReply = useCallback(
    (event) => {
      event.stopPropagation();
      handleSelect();
      if (!nextReplyText) {
        onCompose?.(comment, "reply");
        return;
      }
      onReply?.(comment, nextReplyText);
    },
    [comment, handleSelect, nextReplyText, onCompose, onReply]
  );
  const handleLike = useCallback(
    (event) => {
      event.stopPropagation();
      handleSelect();
      onLike?.(comment);
    },
    [comment, handleSelect, onLike]
  );
  const handlePrivateMessage = useCallback(
    (event) => {
      event.stopPropagation();
      handleSelect();
      if (!nextReplyText) {
        onCompose?.(comment, "private_message");
        return;
      }
      onPrivateMessage?.(comment, nextReplyText);
    },
    [comment, handleSelect, nextReplyText, onCompose, onPrivateMessage]
  );
  const setCommentRef = useCallback((node) => registerCommentNode?.(key, node), [key, registerCommentNode]);
  const cardComment = useMemo(
    () => ({
      ...comment,
      id: key,
      comment_id: key,
      post_id: clean(comment.post_id || ""),
      parent_comment_id: clean(comment.parent_comment_id || comment.parentId || comment.parent_id || ""),
      page_id: clean(comment.page_id || ""),
      platform: clean(comment.platform || activePostPlatform || "facebook"),
      customer_name: firstCommenterName(comment.customer_name, comment.customerName, comment.commenter_name, comment.from?.name) || "عميل",
      customerName: firstCommenterName(comment.customerName, comment.customer_name, comment.commenter_name, comment.from?.name) || "عميل",
      customer_avatar_url: clean(comment.customer_avatar_url || comment.customerAvatar || comment.commenter_profile_picture_url || pictureUrlFrom(comment.from?.picture) || ""),
      customer_profile_id: clean(comment.customer_profile_id || comment.customerProfileId || ""),
      automation_status: clean(comment.automation_status || comment.reply_status || comment.auto_reply_mode || ""),
      private_reply_status: clean(comment.private_reply_status || comment.dm_status || ""),
      like_status: clean(likeStatus || comment.like_status || ""),
      last_ai_action: clean(comment.last_ai_action || comment.ai_last_action || ""),
      product_name: clean(comment.product_name || ""),
    }),
    [activePostPlatform, comment, key, likeStatus]
  );

  return (
    <div
      ref={setCommentRef}
      className={`rounded-[22px] transition ${isHighlighted ? "ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-slate-950" : ""}`}
    >
      <CommentTimelineCard
        comment={cardComment}
        selected={key === selectedCommentKey || isHighlighted}
        onSelect={handleSelect}
        onCustomerSelect={onSelectCustomer}
        compact
      >
        {attachmentPreview ? (
          <a
            href={attachmentPreview}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
          >
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-900">
              <img src={attachmentPreview} alt="" className="h-full w-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/40 to-transparent" />
              <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-slate-950/75 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-100">
                {t("aiSupport.inbox.socialWorkspace.media")}
              </span>
            </div>
          </a>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={handleLike}
            disabled={busy || likeStatus === "sent" || Boolean(likeLoadingKey)}
            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-black disabled:opacity-60 ${likeStatus === "sent" ? "border-blue-400/30 bg-blue-400/15 text-blue-200" : "border-white/10 bg-white/[0.04] text-slate-200"}`}
          >
            {likeLoadingKey === actionKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className={`h-4 w-4 ${likeStatus === "sent" ? "fill-current" : ""}`} />}
            {likeStatus === "sent" ? "تم الإعجاب" : "إعجاب"}
          </button>
          <button
            type="button"
            onClick={handleReply}
            disabled={busy || Boolean(replyLoadingKey)}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-cyan-300 px-2.5 text-[11px] font-black text-slate-950 disabled:opacity-50"
          >
            {replyLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {t("aiSupport.inbox.socialWorkspace.reply")}
          </button>
          <button
            type="button"
            onClick={handlePrivateMessage}
            disabled={busy || !privateMessageSupported || Boolean(privateMessageLoadingKey)}
            title={privateMessageSupported ? "" : "Private messages are only supported for Facebook and Instagram comments"}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-black text-slate-200 disabled:opacity-50"
          >
            {privateMessageLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {privateMessageStatus === "sent" ? t("aiSupport.inbox.socialWorkspace.sent") : t("aiSupport.inbox.socialWorkspace.privateMessage")}
          </button>
        </div>
      </CommentTimelineCard>
    </div>
  );
});

export { SocialCommentsWorkspaceCommentRow, normalizeSocialPostDisplay };

function SocialCommentsWorkspace({
  items = [],
  loading = false,
  error = "",
  selectedPost = null,
  selectedThread = { post: null, comments: [], loading: false, error: "" },
  selectedTemplate = { template: null, loading: false, error: "" },
  globalSettings = {
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
  },
  onRefresh,
  onSelectPost,
  onPrefetchPost,
  onSelectCustomer,
  tenantId = "",
  initialSelectedCommentId = "",
  nextCursor = "",
  onLoadMore,
  loadingMore = false,
  streamlined = true,
  postPlatformFilter = "all",
  onPostPlatformFilterChange,
  commentPlatformFilter = "all",
  onCommentPlatformFilterChange,
}) {
  const { t } = useTranslation();
  const resolvedTenantId = clean(tenantId || selectedPost?.tenant_id || selectedPost?.tenantId || selectedThread?.post?.tenant_id || selectedThread?.post?.tenantId || "");
  const [selectedCommentKey, setSelectedCommentKey] = useState(() => clean(initialSelectedCommentId));
  const [replyDraft, setReplyDraft] = useState("");
  const [previewReply, setPreviewReply] = useState("");
  const [ignoredCommentKeys, setIgnoredCommentKeys] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [openingPost, setOpeningPost] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [replyLoadingKey, setReplyLoadingKey] = useState("");
  const [likeLoadingKey, setLikeLoadingKey] = useState("");
  const [likeStatusOverrides, setLikeStatusOverrides] = useState({});
  const [privateMessageLoadingKey, setPrivateMessageLoadingKey] = useState("");
  const [privateMessageStatusOverrides, setPrivateMessageStatusOverrides] = useState({});
  const [ignoreLoadingKey, setIgnoreLoadingKey] = useState("");
  const [leadLoadingKey, setLeadLoadingKey] = useState("");
  const [replyStatusOverrides, setReplyStatusOverrides] = useState({});
  const [showLatestCommentDetails, setShowLatestCommentDetails] = useState(false);
  const [showProductCardDetails, setShowProductCardDetails] = useState(false);
  const [automationDrawerPostKey, setAutomationDrawerPostKey] = useState("");
  const [productLinksDrawerPostKey, setProductLinksDrawerPostKey] = useState("");
  const [productLinksDrawerPostSnapshot, setProductLinksDrawerPostSnapshot] = useState(null);
  const [productMappingOverrides, setProductMappingOverrides] = useState({});
  const [automationDrafts, setAutomationDrafts] = useState({});
  const [automationLoadingKey, setAutomationLoadingKey] = useState("");
  const [automationSavingKey, setAutomationSavingKey] = useState("");
  const [automationLoadErrors, setAutomationLoadErrors] = useState({});
  const [automationRuns, setAutomationRuns] = useState([]);
  const [automationRunsLoading, setAutomationRunsLoading] = useState(false);
  const [automationRunsError, setAutomationRunsError] = useState("");
  const [automationTesting, setAutomationTesting] = useState(false);
  const [automationTestResult, setAutomationTestResult] = useState(null);
  const [automationSavedConfigs, setAutomationSavedConfigs] = useState({});
  const [highlightedCommentKey, setHighlightedCommentKey] = useState("");
  const [commentWindowSize, setCommentWindowSize] = useState(50);
  const [optimisticCommentEntries, setOptimisticCommentEntries] = useState([]);
  const [globalDraft, setGlobalDraft] = useState(() => ({
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
    ...(globalSettings || {}),
  }));
  const [templateDraft, setTemplateDraft] = useState(() => selectedTemplate?.template || null);
  const commentRefs = useRef(new Map());
  const composerRef = useRef(null);
  const highlightTimerRef = useRef(null);
  const automationConfigCacheRef = useRef(new Map());
  const automationConfigInFlightRef = useRef(new Map());
  const normalizedPosts = useMemo(
    () =>
      [...(Array.isArray(items) ? items.filter(Boolean) : [])]
        .map((post) => {
          const normalized = normalizePost(post);
          const override = productMappingOverrides[postKey(normalized)];
          return override ? normalizePost({ ...(normalized.raw || post || {}), ...override }) : normalized;
        }),
    [items, productMappingOverrides]
  );

  const selectedPostKey = clean(postKey(normalizePost(selectedPost || {})));
  const activePost = selectedPost ? findMatchingNormalizedPost(normalizedPosts, selectedPost) : normalizePost(normalizedPosts[0] || null);
  const activePostKey = clean(postKey(activePost));
  const activeThread = selectedThread || { post: null, comments: [], loading: false, error: "" };
  const comments = useMemo(() => (Array.isArray(activeThread.comments) ? activeThread.comments.filter(Boolean) : []), [activeThread.comments]);
  const normalizedComments = useMemo(() => comments.map((comment) => normalizeComment(comment)).filter(Boolean), [comments]);
  const activeThreadPost = activeThread.post ? findMatchingNormalizedPost(normalizedPosts, activeThread.post) : normalizePost(null);
  const threadPostIdentityComparison = useMemo(
    () => comparePostIdentitySnapshots(activePost || {}, activeThreadPost || {}),
    [activePost, activeThreadPost]
  );
  const syncedThreadPost = threadPostIdentityComparison.matches ? activeThreadPost : null;
  const activePostDetails = normalizePost(syncedThreadPost || activePost || null);
  const activePostDisplay = useMemo(() => normalizeSocialPostDisplay(syncedThreadPost || activePostDetails || activePost || {}), [syncedThreadPost, activePostDetails, activePost]);
  const activeDisplayPost = syncedThreadPost || activePostDetails || activePost || {};
  const activeDisplayLinkedProducts = getPostLinkedProducts(activeDisplayPost);
  const activeAutomationDraftKey = automationDrawerPostKey || activePostKey;
  const activeProductCard = resolveProductCardFields(activeDisplayPost);
  const activeAutomationConfig = automationSavedConfigs[activeAutomationDraftKey] || activePostDetails?.automation_config || activePostDetails?.automationConfig || null;
  const activeAutomationState = resolveAutomationStateLabel({
    post: activePostDetails,
    config: activeAutomationConfig,
    productCount: activeProductCard.productCount,
  });

  useEffect(() => {
    setGlobalDraft({
      generic_enabled: false,
      generic_like_enabled: true,
      generic_reply_enabled: true,
      generic_template: "",
      mode: "manual_approval",
      ...(globalSettings || {}),
    });
  }, [
    globalSettings?.generic_enabled,
    globalSettings?.generic_like_enabled,
    globalSettings?.generic_reply_enabled,
    globalSettings?.generic_template,
    globalSettings?.mode,
  ]);

  useEffect(() => {
    setTemplateDraft(selectedTemplate?.template || null);
  }, [
    selectedPost,
    selectedTemplate?.template?.enabled,
    selectedTemplate?.template?.like_enabled,
    selectedTemplate?.template?.reply_enabled,
    selectedTemplate?.template?.mode,
    selectedTemplate?.template?.template,
  ]);

  useEffect(() => {
    const nextSelected = clean(initialSelectedCommentId);
    if (nextSelected && nextSelected !== selectedCommentKey) {
      setSelectedCommentKey(nextSelected);
    }
  }, [initialSelectedCommentId, selectedCommentKey]);

  useEffect(() => {
    setIgnoredCommentKeys(new Set());
    setSelectedCommentKey(clean(initialSelectedCommentId));
    setPreviewReply("");
    setReplyDraft("");
    setHighlightedCommentKey("");
    setCommentWindowSize(50);
    setOptimisticCommentEntries([]);
  }, [activePostKey, initialSelectedCommentId]);

  const activeTemplate = templateDraft || selectedTemplate?.template || null;
  const currentGlobalSettings = globalDraft || globalSettings;
  const visibleComments = useMemo(() => normalizedComments.filter((comment) => {
    if (ignoredCommentKeys.has(comment.id)) return false;
    if (commentPlatformFilter === "all") return true;
    return clean(comment.platform || comment.metadata?.platform || "").toLowerCase() === commentPlatformFilter;
  }), [commentPlatformFilter, ignoredCommentKeys, normalizedComments]);
  const displayComments = useMemo(() => {
    if (!optimisticCommentEntries.length) return visibleComments;
    return [...optimisticCommentEntries, ...visibleComments];
  }, [optimisticCommentEntries, visibleComments]);
  const selectedVisibleComment =
    visibleComments.find((comment) => comment.id === clean(selectedCommentKey)) ||
    visibleComments[0] ||
    null;
  const actionableComment = selectedVisibleComment || null;
  const commentsToRender = useMemo(
    () => displayComments.slice(0, Math.max(50, commentWindowSize)),
    [commentWindowSize, displayComments]
  );
  const hasMoreComments = displayComments.length > commentsToRender.length;
  const registerCommentNode = useCallback((key, node) => {
    if (!key) return;
    if (node) commentRefs.current.set(key, node);
    else commentRefs.current.delete(key);
  }, []);

  useEffect(() => {
    if (!visibleComments.length) {
      setSelectedCommentKey("");
      setHighlightedCommentKey("");
      return;
    }
    const preferredKey = clean(initialSelectedCommentId || selectedCommentKey);
    const nextSelected =
      visibleComments.find((comment) => comment.id === preferredKey) ||
      visibleComments.find((comment) => comment.id === clean(selectedCommentKey)) ||
      visibleComments[0] ||
      null;
    const nextKey = clean(nextSelected?.id || "");
    if (nextKey && nextKey !== selectedCommentKey) {
      setSelectedCommentKey(nextKey);
    }
  }, [initialSelectedCommentId, selectedCommentKey, visibleComments]);

  useEffect(() => {
    const targetKey = clean(selectedCommentKey);
    if (!targetKey) return;

    const targetIndex = displayComments.findIndex((comment) => comment.id === targetKey);
    if (targetIndex < 0) return;
    if (targetIndex < commentWindowSize) return;

    setCommentWindowSize((current) => Math.max(current, targetIndex + 1));
  }, [commentWindowSize, displayComments, selectedCommentKey]);

  useEffect(() => {
    const targetKey = clean(selectedCommentKey);
    if (!targetKey) return undefined;
    const targetNode = commentRefs.current.get(targetKey);
    if (!targetNode) return undefined;

    targetNode.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedCommentKey(targetKey);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedCommentKey((current) => (current === targetKey ? "" : current));
    }, 2500);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus?.();
    });

    return () => {
      if (highlightTimerRef.current) {
        window.clearTimeout(highlightTimerRef.current);
      }
    };
  }, [commentWindowSize, commentsToRender.length, selectedCommentKey]);

  const activeSuggestedReply = useMemo(
    () =>
      templatePreviewText(activeTemplate || { template: currentGlobalSettings.generic_template || "" }, {
        customer_name: selectFirst(resolveCommentCustomerName(actionableComment)),
        product_name: selectFirst(activePostDetails?.productName, ""),
        price: selectFirst(activePostDetails?.productPrice, ""),
        sale_price: selectFirst(activePostDetails?.productSalePrice, ""),
        sizes: selectFirst(activePostDetails?.productSizes, ""),
        colors: selectFirst(activePostDetails?.productColors, ""),
        product_link: selectFirst(activePostDetails?.productLink, ""),
        post_link: selectFirst(activePostDetails?.permalinkUrl, ""),
        store_address: selectFirst(activePostDetails?.storeAddress, ""),
        shipping_time: selectFirst(activePostDetails?.shippingTime, ""),
      }),
    [actionableComment, activePostDetails, activeTemplate, currentGlobalSettings.generic_template]
  );

  const suggestedReply = previewReply || activeSuggestedReply || "";
  const activePrivateMessageStatus = clean(privateMessageStatusOverrides[actionableComment?.id] || "");
  const activePostImage = clean(activePostDisplay?.displayImage || activePostDetails?.thumbnailUrl || "");
  const activePostCaption = clean(activePostDisplay?.displayText || activePostDetails?.caption || "");
  const activePostExcerpt = clean(activePostDisplay?.displayExcerpt || activePostDisplay?.summary || activePostDetails?.excerpt || activePostCaption);
  const activePostOpen = useMemo(
    () => resolvePostOpenLink(activePostDetails || activePost || {}, activePostDisplay || {}),
    [activePost, activePostDetails, activePostDisplay]
  );
  const activePostLink = clean(activePostOpen.finalUrl || "");
  const activePlatform = platformMeta(activePostDetails?.platform || activePost?.platform || "");
  const activePostType = postTypeMeta(activePostDetails);
  const activePostPlatform = clean(activePostDetails?.platform || activePost?.platform || "facebook").toLowerCase();
  const activePostPostId = clean(activePostDetails?.postId || activePostDetails?.id || activePostKey);
  const activePostSourceId = clean(activePostDetails?.sourcePostId || activePostDetails?.raw?.post_id || activePostDetails?.raw?.id || "");
  const activePostConversationId = clean(activePostDetails?.conversationId || activePostDetails?.sessionId || activePostDetails?.id || activePostKey);
  const activeTemplateEnabled = Boolean(activeTemplate?.enabled);
  const activePostPublishedAt = clean(
    activePostDisplay?.displayCreatedAt ||
      activePostDetails?.postCreatedTime ||
      activePostDetails?.post_created_time ||
      activePostDetails?.publishedAt ||
      activePostDetails?.published_at ||
      activePostDetails?.realCommentCreatedTime ||
      activePostDetails?.real_comment_created_time ||
      activePostDetails?.commentCreatedTime ||
      activePostDetails?.comment_created_time ||
      ""
  );
  const activePostLikes = activePostDetails?.likesCount;
  const activePostShares = activePostDetails?.sharesCount;
  const activePostMediaBadge = resolvePostMediaBadge(activePostDetails) || postTypeMeta(activePostDetails);
  const automationDrawerPost = useMemo(() => {
    const drawerKey = clean(automationDrawerPostKey);
    if (!drawerKey) return null;
    return normalizedPosts.find((item) => postKey(item) === drawerKey) || (drawerKey === activePostKey ? activePostDetails : null);
  }, [activePostDetails, activePostKey, automationDrawerPostKey, normalizedPosts]);
  const activeAutomationDraft =
    automationDrafts[activeAutomationDraftKey] ||
    buildAutomationDraft(automationDrawerPost || activePostDetails || activePost || {});
  const activeAutomationRuntime = automationRuns?.[0] || automationTestResult || null;
  const activeAutomationRuntimeMonitor =
    activeAutomationRuntime?.runtime_monitor && typeof activeAutomationRuntime.runtime_monitor === "object" && !Array.isArray(activeAutomationRuntime.runtime_monitor)
      ? activeAutomationRuntime.runtime_monitor
      : {};
  const activeAutomationAiSales =
    activeAutomationRuntimeMonitor?.ai_sales && typeof activeAutomationRuntimeMonitor.ai_sales === "object" && !Array.isArray(activeAutomationRuntimeMonitor.ai_sales)
      ? activeAutomationRuntimeMonitor.ai_sales
      : activeAutomationRuntime?.raw_runtime_context?.ai_sales && typeof activeAutomationRuntime.raw_runtime_context.ai_sales === "object" && !Array.isArray(activeAutomationRuntime.raw_runtime_context.ai_sales)
        ? activeAutomationRuntime.raw_runtime_context.ai_sales
        : {};
  const latestRuntimePostSnapshot = useMemo(() => {
    const runtimeMonitor = activeAutomationRuntime?.runtime_monitor && typeof activeAutomationRuntime.runtime_monitor === "object" && !Array.isArray(activeAutomationRuntime.runtime_monitor)
      ? activeAutomationRuntime.runtime_monitor
      : {};
    const rawRuntimeContext = activeAutomationRuntime?.raw_runtime_context && typeof activeAutomationRuntime.raw_runtime_context === "object" && !Array.isArray(activeAutomationRuntime.raw_runtime_context)
      ? activeAutomationRuntime.raw_runtime_context
      : {};
    const latestCommentPostId = clean(
      activeAutomationRuntime?.resolved_post_id ||
        runtimeMonitor?.resolved_post_id ||
        rawRuntimeContext?.resolved_post_id ||
        rawRuntimeContext?.selected_post_id ||
        activeAutomationRuntime?.post_id ||
        runtimeMonitor?.post_id ||
        ""
    );
    const latestCommentPermalink = clean(
      activeAutomationRuntime?.post_permalink_url ||
        activeAutomationRuntime?.post_permalink ||
        activeAutomationRuntime?.permalink_url ||
        runtimeMonitor?.post_permalink_url ||
        runtimeMonitor?.post_permalink ||
        runtimeMonitor?.permalink_url ||
        rawRuntimeContext?.post_permalink_url ||
        rawRuntimeContext?.post_permalink ||
        rawRuntimeContext?.permalink_url ||
        rawRuntimeContext?.selected_post_permalink ||
        rawRuntimeContext?.post_url ||
        ""
    );
    return {
      postId: latestCommentPostId,
      permalink: latestCommentPermalink,
      platform: clean(activeAutomationRuntime?.platform || activePostPlatform || "facebook") || "facebook",
      sourcePostId: clean(
        activeAutomationRuntime?.resolved_platform_post_id ||
          runtimeMonitor?.resolved_platform_post_id ||
        rawRuntimeContext?.resolved_platform_post_id ||
        latestCommentPostId
      ),
      selectedPostIdentity: activePostDetails?.selected_post_identity || activePostDetails?.raw?.selected_post_identity || null,
      latestCommentIdentity: activePostDetails?.latest_comment_post_identity || activePostDetails?.raw?.latest_comment_post_identity || null,
      postIdentityMismatch: Boolean(activePostDetails?.post_identity_mismatch || activePostDetails?.raw?.post_identity_mismatch),
      postIdentityMismatchReason: clean(activePostDetails?.post_identity_mismatch_reason || activePostDetails?.raw?.post_identity_mismatch_reason || ""),
    };
  }, [activeAutomationRuntime, activePostDetails, activePostPlatform]);
  const latestCommentMismatch = useMemo(() => {
    const latestCommentPostId = clean(latestRuntimePostSnapshot.postId);
    if (!latestCommentPostId || !activePostKey) return null;
    const latestIdentitySeed = {
      postId: latestCommentPostId,
      canonicalPostId: clean(latestRuntimePostSnapshot.latestCommentIdentity?.canonical_post_id || latestCommentPostId),
      sourcePostId: clean(latestRuntimePostSnapshot.latestCommentIdentity?.source_post_id || latestRuntimePostSnapshot.sourcePostId || latestCommentPostId),
      platformPostId: clean(latestRuntimePostSnapshot.latestCommentIdentity?.platform_post_id || latestRuntimePostSnapshot.sourcePostId || latestCommentPostId),
      permalink_url: clean(latestRuntimePostSnapshot.latestCommentIdentity?.permalink_url || latestRuntimePostSnapshot.permalink || ""),
      raw: {
        permalink_post_id: clean(latestRuntimePostSnapshot.latestCommentIdentity?.permalink_post_id || ""),
        object_id: clean(latestRuntimePostSnapshot.latestCommentIdentity?.object_id || ""),
      },
    };
    const selectedIdentitySeed = {
      ...(activePostDetails || {}),
      selected_post_identity: latestRuntimePostSnapshot.selectedPostIdentity || activePostDetails?.selected_post_identity || null,
    };
    const latestIdentitySnapshot = buildPostIdentitySnapshot(latestIdentitySeed);
    const selectedIdentitySnapshot = buildPostIdentitySnapshot(selectedIdentitySeed);
    const latestKnownPost = normalizedPosts.find((item) => comparePostIdentitySnapshots(item, latestIdentitySnapshot).matches) || null;
    const latestKnownPostNormalized = latestKnownPost ? normalizePost(latestKnownPost) : null;
    const latestKnownProductCount = latestKnownPostNormalized ? resolveProductCardFields(latestKnownPostNormalized).productCount : 0;
    const identityComparison = comparePostIdentitySnapshots(selectedIdentitySnapshot, latestKnownPostNormalized || latestIdentitySnapshot);
    if (!latestRuntimePostSnapshot.postIdentityMismatch && identityComparison.matches) return null;
    const selectedStatusLabel = [
      activeProductCard.productCount > 0 ? "already linked" : "not linked",
      activeAutomationState.enabled ? "automation enabled" : "automation disabled",
    ].join(" / ");
    const latestStatusLabel = latestKnownProductCount > 0 ? "already linked" : "needs product link";
    const resolvedLatestPost = latestKnownPostNormalized || null;
    const latestFallbackPost = normalizePost(latestIdentitySeed);
    const resolvedLatestOpen = resolvePostOpenLink(
      resolvedLatestPost || latestFallbackPost,
      normalizeSocialPostDisplay(resolvedLatestPost || latestFallbackPost)
    );
    socialDebugLog("SOCIAL_LATEST_COMMENT_IDENTITY_TRACE", {
      selectedPostIdentity: latestRuntimePostSnapshot.selectedPostIdentity || activePostDetails?.selected_post_identity || null,
      latestCommentIdentity: latestRuntimePostSnapshot.latestCommentIdentity || latestIdentitySeed,
      selectedPermalink: activePostLink || "",
      latestCommentPermalink: clean(resolvedLatestOpen.finalUrl || latestRuntimePostSnapshot.permalink || ""),
      resolvedLatestNormalizedPost: resolvedLatestPost,
      resolvedSelectedNormalizedPost: activePostDetails,
      post_identity_mismatch: true,
      reason: clean(latestRuntimePostSnapshot.postIdentityMismatchReason || identityComparison.reason || "identity_values_disagree"),
    });
    return {
      selectedPostId: activePostPostId || dash,
      latestCommentPostId,
      selectedPermalink: activePostLink || "",
      latestCommentPermalink: clean(resolvedLatestOpen.finalUrl || latestRuntimePostSnapshot.permalink || ""),
      selectedStatusLabel,
      latestStatusLabel,
      hasResolvedLatestPost: Boolean(resolvedLatestPost?.postId),
      latestKnownPost: latestKnownPostNormalized,
      latestPost: resolvedLatestPost,
      latestFallbackPost,
      reason: clean(latestRuntimePostSnapshot.postIdentityMismatchReason || identityComparison.reason || "identity_values_disagree"),
    };
  }, [activeAutomationState.enabled, activePostDetails, activePostKey, activePostLink, activePostPostId, activePostSourceId, activeProductCard.productCount, latestRuntimePostSnapshot, normalizedPosts]);
  const productLinksDrawerPost = useMemo(() => {
    const drawerKey = clean(productLinksDrawerPostKey);
    if (!drawerKey) return null;
    return (
      productLinksDrawerPostSnapshot ||
      normalizedPosts.find((item) => postKey(item) === drawerKey) ||
      (drawerKey === activePostKey ? activePostDetails : null)
    );
  }, [activePostDetails, activePostKey, normalizedPosts, productLinksDrawerPostKey, productLinksDrawerPostSnapshot]);

  const getPostVisibleTime = useCallback((post = {}) => {
    const time = clean(
      post?.display_post_time ||
        post?.displayPostTime ||
        post?.postCreatedTime ||
        post?.post_created_time ||
        post?.publishedAt ||
        post?.published_at ||
        post?.realCommentCreatedTime ||
        post?.real_comment_created_time ||
        post?.commentCreatedTime ||
        post?.comment_created_time ||
        ""
    );
    return time;
  }, []);

  const logCardKeyParity = useCallback((post = {}) => {
    const normalized = normalizePost(post || {});
    const linkedProductNames = Array.isArray(normalized.linked_products)
      ? normalized.linked_products.map((item) => clean(item?.name || item?.title || item?.product_name || "")).filter(Boolean)
      : [];
    console.info("SOCIAL_V2_CARD_DRAWER_KEY_PARITY_TRACE", {
      card_post_id: clean(normalized.postId || normalized.id || normalized.conversationId || ""),
      card_title: clean(normalized.caption || ""),
      card_post_link_key: clean(normalized.post_link_key || normalized.product_link_identity?.product_link_key || normalized.productLinkKey || ""),
      drawer_post_link_key_if_selected: clean(productLinksDrawerPostKey || productLinksDrawerPostSnapshot?.post_link_key || productLinksDrawerPost?.post_link_key || ""),
      linked_products_count: Number(normalized.linkedProductsCount || normalized.linked_products_count || 0) || 0,
      linked_product_names: linkedProductNames,
      raw_ids: {
        id: clean(normalized.raw?.id || normalized.id || ""),
        post_id: clean(normalized.raw?.post_id || normalized.postId || ""),
        canonical_post_id: clean(normalized.raw?.canonical_post_id || normalized.canonicalPostId || ""),
        platform_post_id: clean(normalized.raw?.platform_post_id || normalized.platformPostId || ""),
        source_post_id: clean(normalized.raw?.source_post_id || normalized.sourcePostId || ""),
        permalink_post_id: clean(normalized.raw?.permalink_post_id || normalized.permalinkPostId || ""),
        conversation_id: clean(normalized.raw?.conversation_id || normalized.conversationId || ""),
        permalink_url: clean(normalized.permalinkUrl || normalized.raw?.permalink_url || ""),
      },
    });
  }, [productLinksDrawerPost, productLinksDrawerPostKey, productLinksDrawerPostSnapshot]);

  const handleSelectCardPost = useCallback(
    (post = {}, fallbackKey = "") => {
      if (!onSelectPost) return;
      const selectedSelectionKey = postSelectionKey(post) || clean(fallbackKey);
      const selectedKey = selectedSelectionKey || clean(postKey(post) || fallbackKey);
      const usedFallback = !postSelectionKey(post) && Boolean(clean(fallbackKey));
      socialDebugLog("SOCIAL_POST_CARD_CLICK_SELECT_TRACE", {
        clicked_card_key: clean(fallbackKey || postKey(post) || ""),
        clicked_title: clean(post?.caption || post?.displayText || post?.title || ""),
        clicked_post_link_key: clean(post?.post_link_key || post?.postLinkKey || ""),
        selected_key_after_click: selectedKey,
        selected_title_after_click: clean(post?.caption || post?.displayText || post?.title || ""),
        used_fallback: usedFallback,
        reason: usedFallback ? "selection_key_missing" : "direct_exact_selection",
      });
      onSelectPost(post, selectedKey);
    },
    [onSelectPost]
  );

  const updateAutomationDraft = (patch = {}) => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    setAutomationDrafts((current) => {
      const existing = current[drawerKey] || buildAutomationDraft(automationDrawerPost || activePostDetails || activePost || {});
      return {
        ...current,
        [drawerKey]: {
          ...existing,
          ...patch,
        },
      };
    });
  };

  const handleAutomationSelectTemplate = (templateId = "") => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    setAutomationDrafts((current) => {
      const existing = current[drawerKey] || buildAutomationDraft(automationDrawerPost || activePostDetails || activePost || {});
      return {
        ...current,
        [drawerKey]: applyAutomationTemplate(existing, templateId, automationDrawerPost || activePostDetails || activePost || {}),
      };
    });
    notify("emerald", "تم تغيير قالب الأتمتة محليًا");
  };

  const handleAutomationLoadRuns = async (drawerKey = "") => {
    const key = clean(drawerKey || automationDrawerPostKey || activePostKey);
    if (!key) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
    const routePostId = automationRoutePostId(postForAutomation, key);
    setAutomationRunsLoading(true);
    setAutomationRunsError("");
    try {
      const payload = await api.get(`/social-comments/automation/${encodeURIComponent(routePostId)}/runs`, {
        params: { tenant_id: resolvedTenantId, platform: platformForAutomation, limit: 10 },
      });
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data?.items)
          ? payload.data.items
          : Array.isArray(payload)
            ? payload
            : [];
      setAutomationRuns(items);
    } catch (error) {
      setAutomationRuns([]);
      setAutomationRunsError(error?.message || "Failed to load recent runs");
    } finally {
      setAutomationRunsLoading(false);
    }
  };

  const handleAutomationTest = async () => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
    const routePostId = automationRoutePostId(postForAutomation, drawerKey);
    setAutomationTesting(true);
    setAutomationTestResult(null);
    try {
      const payload = await api.post(`/social-comments/automation/${encodeURIComponent(routePostId)}/test`, {
        tenant_id: resolvedTenantId,
        platform: platformForAutomation,
      });
      const result = payload?.result || payload?.data?.result || payload?.data || payload || {};
      setAutomationTestResult(result);
      notify("emerald", "تم تنفيذ اختبار الأتمتة محليًا");
    } catch (error) {
      notify("rose", error?.message || "تعذر تنفيذ اختبار الأتمتة");
    } finally {
      setAutomationTesting(false);
    }
  };

  const loadAutomationConfig = useCallback(
    async (drawerKey = "", postForAutomation = {}, options = {}) => {
      const key = clean(drawerKey || automationDrawerPostKey || activePostKey);
      if (!key) return null;
      const force = Boolean(options?.force);
      if (!force && automationConfigCacheRef.current.has(key)) {
        return automationConfigCacheRef.current.get(key);
      }
      if (!force && automationConfigInFlightRef.current.has(key)) {
        return automationConfigInFlightRef.current.get(key);
      }
      const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
      const routePostId = automationRoutePostId(postForAutomation, key);
      const request = api.get(`/social-comments/automation/${encodeURIComponent(routePostId)}`, {
        params: { tenant_id: resolvedTenantId, platform: platformForAutomation },
      })
        .then((payload) => {
          const config = payload?.config || payload?.data || payload || {};
          const normalized = normalizeAutomationConfig(config, postForAutomation);
          const savedConfig = {
            config_id: clean(config?.id || config?.config_id || ""),
            tenant_id: clean(config?.tenant_id || resolvedTenantId || ""),
            platform: clean(config?.platform || platformForAutomation || "facebook") || "facebook",
            saved_post_id: clean(config?.post_id || key),
            enabled: Boolean(config?.enabled),
            template_key: clean(config?.template_key || normalized.templateId || ""),
            settings: config?.settings || {},
            message_templates: config?.message_templates || {},
            raw: config,
          };
          const result = { normalized, savedConfig };
          automationConfigCacheRef.current.set(key, result);
          setAutomationSavedConfigs((current) => ({
            ...current,
            [key]: savedConfig,
          }));
          return result;
        })
        .catch((error) => {
          automationConfigCacheRef.current.set(key, null);
          throw error;
        })
        .finally(() => {
          automationConfigInFlightRef.current.delete(key);
        });
      automationConfigInFlightRef.current.set(key, request);
      return request;
    },
    [activePostKey, activePostPlatform, automationDrawerPostKey, resolvedTenantId]
  );

  useEffect(() => {
    if (!activePostKey) return;
    if (automationConfigCacheRef.current.has(activePostKey)) return;
    if (automationSavedConfigs[activePostKey]?.config_id) return;
    const postForAutomation = activeThreadPost || activePostDetails || activePost || {};
    void loadAutomationConfig(activePostKey, postForAutomation).catch(() => {});
  }, [activePostKey, activePostDetails, activePost, activeThreadPost, automationSavedConfigs, loadAutomationConfig]);

  const handleAutomationSaveLocal = (draftPatch = null) => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const currentDraft = automationDrafts[drawerKey] || buildAutomationDraft(postForAutomation);
    const safeDraftPatch = isEventLikeObject(draftPatch) ? null : draftPatch;
    const nextDraft = safeDraftPatch ? { ...currentDraft, ...safeDraftPatch } : currentDraft;
    socialDebugLog("SOCIAL_COMMENT_UI_AUTOMATION_ENABLE_CLICK", {
      config_id: clean(automationSavedConfigs[drawerKey]?.config_id || ""),
      canonical_post_id: clean(postForAutomation?.canonicalPostId || postForAutomation?.canonical_post_id || postForAutomation?.postId || drawerKey),
      enabled_before: Boolean(currentDraft?.enabled),
      enabled_after: Boolean(nextDraft?.enabled),
      trigger: safeDraftPatch ? "patched_save" : "save_button",
    });
    if (Object.prototype.hasOwnProperty.call(safeDraftPatch || {}, "enabled")) {
      socialDebugLog("SOCIAL_COMMENT_UI_AUTOMATION_ENABLE_PATCH", {
        config_id: clean(automationSavedConfigs[drawerKey]?.config_id || ""),
        canonical_post_id: clean(postForAutomation?.canonicalPostId || postForAutomation?.canonical_post_id || postForAutomation?.postId || drawerKey),
        enabled_before: Boolean(currentDraft?.enabled),
        enabled_after: Boolean(nextDraft?.enabled),
      });
    }
    setAutomationDrafts((current) => ({
      ...current,
      [drawerKey]: nextDraft,
    }));
    void handleAutomationSaveRemote(nextDraft);
  };

  const handleAutomationReset = () => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    setAutomationDrafts((current) => ({
      ...current,
      [drawerKey]: buildAutomationDraft(automationDrawerPost || activePostDetails || activePost || {}),
    }));
    notify("amber", "تمت إعادة تعيين مسودة الأتمتة");
  };

  const handleOpenAutomationDrawer = (post = null, key = "") => {
    const drawerPostKey = clean(key || postKey(post || activePostDetails || activePost || {}));
    if (!drawerPostKey) return;
    setAutomationDrawerPostKey(drawerPostKey);
  };

  const handleOpenProductLinksDrawer = (post = null, key = "") => {
    const drawerPostKey = clean(post?.post_link_key || post?.postLinkKey || key || postKey(post || activePostDetails || activePost || {}));
    if (!drawerPostKey) return;
    socialDebugLog("POST_PRODUCT_LINKS_UI_OPEN_DRAWER", {
      drawerPostKey,
      clickedPostKey: clean(postKey(post || {})),
      activePostKey,
      activeItemId: clean(activePostDetails?.conversationId || activePostDetails?.postId || activePostDetails?.id || ""),
      selectedPostKey: clean(postKey(selectedPost || {})),
    });
    setProductLinksDrawerPostSnapshot(post ? normalizePost(post) : null);
    setProductLinksDrawerPostKey(drawerPostKey);
  };

  useEffect(() => {
    const drawerKey = clean(automationDrawerPostKey);
    if (!drawerKey) return;

    let cancelled = false;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";

    setAutomationLoadingKey(drawerKey);
    setAutomationLoadErrors((current) => {
      if (!current[drawerKey]) return current;
      const next = { ...current };
      delete next[drawerKey];
      return next;
    });

    const fallbackDraft = buildAutomationDraft(postForAutomation);
    setAutomationDrafts((current) => ({
      ...current,
      [drawerKey]: current[drawerKey] || fallbackDraft,
    }));

    loadAutomationConfig(drawerKey, postForAutomation)
      .then(({ normalized, savedConfig }) => {
        if (cancelled || !normalized) return;
        const config = savedConfig?.raw || {};
        setAutomationDrafts((current) => ({
          ...current,
          [drawerKey]: {
            ...fallbackDraft,
            ...normalized,
            productId: clean(config?.product_id || config?.productId || postForAutomation?.productId || fallbackDraft.productId),
            product_id: clean(config?.product_id || config?.productId || postForAutomation?.productId || fallbackDraft.productId),
          },
        }));
      })
      .catch((error) => {
        if (cancelled) return;
        setAutomationLoadErrors((current) => ({
          ...current,
          [drawerKey]: error?.message || "Failed to load automation config",
        }));
      })
      .finally(() => {
        if (!cancelled) {
          setAutomationLoadingKey((current) => (current === drawerKey ? "" : current));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePost, activePostKey, activePostPlatform, automationDrawerPost, automationDrawerPostKey, loadAutomationConfig, resolvedTenantId]);

  useEffect(() => {
    const drawerKey = clean(automationDrawerPostKey);
    if (!drawerKey) {
      setAutomationRuns([]);
      setAutomationRunsError("");
      setAutomationTestResult(null);
      return;
    }
    void handleAutomationLoadRuns(drawerKey);
  }, [automationDrawerPostKey, automationDrawerPost?.id, automationDrawerPost?.postId, activePostKey, activePostPlatform, resolvedTenantId]);

  const handleAutomationSaveRemote = async (draftOverride = null) => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
    const canonicalRoutePostId = automationRoutePostId(postForAutomation, drawerKey);
    const draft = draftOverride || automationDrafts[drawerKey] || buildAutomationDraft(postForAutomation);
    const payload = serializeAutomationDraft(draft, postForAutomation);
    socialDebugLog("SOCIAL_COMMENT_UI_AUTOMATION_API_REQUEST", {
      config_id: clean(automationSavedConfigs[drawerKey]?.config_id || ""),
      canonical_post_id: clean(postForAutomation?.canonicalPostId || postForAutomation?.canonical_post_id || postForAutomation?.postId || drawerKey),
      enabled_before: Boolean(automationSavedConfigs[drawerKey]?.enabled),
      enabled_after: Boolean(payload.enabled),
      payload_enabled: Boolean(payload.enabled),
      payload_settings_enabled: Boolean(payload?.settings?.enabled),
    });
    setAutomationSavingKey(drawerKey);
    try {
      const response = await api.put(`/social-comments/automation/${encodeURIComponent(canonicalRoutePostId)}`, {
        tenant_id: resolvedTenantId,
        platform: platformForAutomation,
        canonical_post_id: canonicalRoutePostId,
        post_id: canonicalRoutePostId,
        ...payload,
      });
      automationConfigCacheRef.current.delete(drawerKey);
      const savedConfig = response?.config || response?.data || response || {};
      const normalized = normalizeAutomationConfig(savedConfig, postForAutomation);
      const verification = await loadAutomationConfig(drawerKey, postForAutomation);
      if (!verification?.normalized) {
        throw new Error("Failed to read back saved automation config");
      }
      const verifiedDraft = verification.normalized;
      const verifiedSavedConfig = verification.savedConfig;
      setAutomationDrafts((current) => ({
        ...current,
        [drawerKey]: {
          ...draft,
          ...verifiedDraft,
          ...normalized,
          productId: clean(savedConfig?.product_id || savedConfig?.productId || draft.productId || postForAutomation?.productId || ""),
          product_id: clean(savedConfig?.product_id || savedConfig?.productId || draft.productId || postForAutomation?.productId || ""),
        },
      }));
      if (verifiedSavedConfig) {
        setAutomationSavedConfigs((current) => ({
          ...current,
          [drawerKey]: verifiedSavedConfig,
        }));
      }
      void handleAutomationLoadRuns(drawerKey);
      notify("emerald", "تم حفظ إعدادات الأتمتة");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      setAutomationLoadErrors((current) => ({
        ...current,
        [drawerKey]: error?.message || "Failed to save automation config",
      }));
      notify("amber", error?.message || "تعذر حفظ إعدادات الأتمتة، تم الاحتفاظ بالمسودة محليًا");
    } finally {
      setAutomationSavingKey((current) => (current === drawerKey ? "" : current));
    }
  };

  useEffect(() => {
    setReplyDraft(activeSuggestedReply || "");
    setPreviewReply("");
  }, [activePostKey, activeSuggestedReply]);

  const isBusy = (key) =>
    Boolean(
      key &&
        (replyLoadingKey === key ||
          privateMessageLoadingKey === key ||
          ignoreLoadingKey === key ||
          leadLoadingKey === key)
    );

  const notify = (tone, text) => {
    const message = clean(text);
    if (!message) return;
    if (tone === "rose") return toast.error(message);
    if (tone === "amber") return toast(message, { icon: "⚠️" });
    if (tone === "emerald") return toast.success(message);
    return toast(message);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.resolve(onRefresh?.());
      notify("emerald", "تم تحديث التعليقات");
    } catch (error) {
      notify("rose", error?.message || "تعذر تحديث التعليقات");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!activePostKey) return;
    void handleAutomationLoadRuns(activePostKey);
  }, [activePostKey]);

  const handleProductLinksSaved = async (payload = {}) => {
    const savedIdentity = payload?.post_identity && typeof payload.post_identity === "object" && !Array.isArray(payload.post_identity)
      ? payload.post_identity
      : {};
    const linkedProducts = Array.isArray(payload?.linked_products) ? payload.linked_products : [];
    const primaryProduct = payload?.primary_product || payload?.primary_linked_product || linkedProducts[0] || null;
    const targetPost = productLinksDrawerPost || activePostDetails || activePost || {};
    const savedPostLinkKey = clean(payload?.post_link_key || payload?.postLinkKey || savedIdentity.post_link_key || targetPost?.post_link_key || "");
    const overrideTarget = {
      ...(targetPost?.raw || targetPost || {}),
      platform: clean(targetPost?.platform || payload?.platform || "facebook") || "facebook",
      post_link_key: savedPostLinkKey || clean(targetPost?.post_link_key || ""),
      platformPostId: clean(savedIdentity.platform_post_id || targetPost?.platformPostId || targetPost?.platform_post_id || ""),
      sourcePostId: clean(savedIdentity.source_post_id || targetPost?.sourcePostId || targetPost?.source_post_id || targetPost?.postId || targetPost?.post_id || ""),
      permalinkPostId: clean(savedIdentity.permalink_post_id || targetPost?.permalinkPostId || targetPost?.permalink_post_id || ""),
      canonicalPostId: clean(savedIdentity.canonical_post_id || targetPost?.canonicalPostId || targetPost?.canonical_post_id || payload?.canonical_post_id || payload?.post_id || ""),
    };
    const updatedCardKey = clean(savedPostLinkKey || postKey(overrideTarget));
    if (updatedCardKey) {
      const nextOverride = {
        ...payload,
        linked_products: linkedProducts,
        linked_products_count: Number(payload?.count ?? payload?.linked_products_count ?? linkedProducts.length ?? 0) || 0,
        primary_product: primaryProduct,
        primary_linked_product: primaryProduct,
        product_link_source: linkedProducts.length ? "v2_direct" : "none",
        has_direct_product_link: linkedProducts.length > 0,
        has_sibling_product_context: false,
        post_link_key: updatedCardKey,
      };
      socialDebugLog("SOCIAL_MANUAL_LINK_WRITE_TRACE", {
        selected_normalized_post_identity: {
          platform_post_id: clean(overrideTarget.platformPostId || ""),
          source_post_id: clean(overrideTarget.sourcePostId || ""),
          permalink_post_id: clean(overrideTarget.permalinkPostId || ""),
          canonical_post_id: clean(overrideTarget.canonicalPostId || ""),
        },
        write_payload: {
          product_ids: linkedProducts.map((item) => item.product_id || item.id || null).filter(Boolean),
          primary_product_id: primaryProduct?.product_id || primaryProduct?.id || null,
        },
        returned_linked_products: linkedProducts.map((item) => clean(item?.name || item?.title || item?.product_name || "")),
        updated_card_key: updatedCardKey,
      });
      setProductMappingOverrides((current) => {
        const next = { ...current };
        delete next[productLinksDrawerPostKey];
        next[updatedCardKey] = nextOverride;
        return next;
      });
    }
  };

  const openSocialPostUrl = (url = "") => {
    const resolvedUrl = clean(url);
    if (!resolvedUrl) {
      notify("amber", "No Facebook permalink available");
      return;
    }
    setOpeningPost(true);
    try {
      const opened = window.open(resolvedUrl, "_blank", "noopener,noreferrer");
      if (!opened) {
        notify("amber", "تعذر فتح الرابط، تحقق من إعدادات المتصفح");
        return;
      }
      notify("emerald", "تم فتح البوست");
    } catch {
      notify("rose", "تعذر فتح البوست");
    } finally {
      window.setTimeout(() => setOpeningPost(false), 200);
    }
  };

  const handleOpenPost = () => {
    openSocialPostUrl(activePostLink);
  };

  const handleOpenLatestCommentPost = () => {
    openSocialPostUrl(latestCommentMismatch?.latestCommentPermalink || "");
  };

  const handleLinkLatestCommentPost = () => {
    if (!latestCommentMismatch?.latestPost?.postId) {
      notify("amber", "لا يوجد post id لربط المنتج");
      return;
    }
    handleOpenProductLinksDrawer(latestCommentMismatch.latestPost, latestCommentMismatch.latestPost.postId);
  };

  const handleSwitchToLatestCommentPost = () => {
    if (!latestCommentMismatch?.hasResolvedLatestPost || !latestCommentMismatch?.latestPost?.postId || !onSelectPost) {
      notify("amber", "تعذر فتح البوست الأحدث داخل مساحة العمل");
      return;
    }
    const nextPost = latestCommentMismatch.latestKnownPost?.raw || latestCommentMismatch.latestPost;
    const nextKey = clean(postKey(latestCommentMismatch.latestKnownPost || latestCommentMismatch.latestPost) || latestCommentMismatch.latestPost.postId);
    onSelectPost(nextPost, nextKey);
  };

  const handleCopySuggestedReply = async () => {
    const textToCopy = clean(suggestedReply || replyDraft);
    if (!textToCopy) {
      notify("amber", "لا يوجد رد مقترح للنسخ");
      return;
    }
    try {
      await navigator.clipboard.writeText(textToCopy);
      notify("emerald", "تم نسخ الرد المقترح");
    } catch {
      setReplyDraft(textToCopy);
      notify("amber", "تعذر النسخ، تم وضع النص في مربع الرد");
    }
  };

  const handleSaveGlobalSettings = async () => {
    if (clean(currentGlobalSettings.mode) === "full_auto") {
      const confirmed = window.confirm(t("aiSupport.inbox.socialWorkspace.confirmGlobalFullAuto"));
      if (!confirmed) {
        notify("amber", "تم إلغاء حفظ Full Auto");
        return;
      }
    }
    setSavingGlobal(true);
    try {
      const payload = await api.post("/social-comments/auto-reply/settings", currentGlobalSettings);
      setGlobalDraft({
        generic_enabled: Boolean(payload?.settings?.generic_enabled),
        generic_like_enabled: payload?.settings?.generic_like_enabled !== false,
        generic_reply_enabled: payload?.settings?.generic_reply_enabled !== false,
        generic_template: clean(payload?.settings?.generic_template || ""),
        mode: clean(payload?.settings?.mode || "manual_approval") || "manual_approval",
      });
      notify("emerald", "تم حفظ إعدادات الرد التلقائي");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      notify("rose", error?.message || "تعذر حفظ الإعدادات");
    } finally {
      setSavingGlobal(false);
    }
  };

  const handleSaveTemplate = async () => {
    const postId = clean(activePostPostId);
    if (!postId) {
      notify("amber", "اختر بوستًا أولًا");
      return;
    }
    if (clean(activeTemplate?.mode) === "full_auto") {
      const confirmed = window.confirm(t("aiSupport.inbox.socialWorkspace.confirmPostFullAuto"));
      if (!confirmed) {
        notify("amber", "تم إلغاء حفظ Full Auto");
        return;
      }
    }
    setSavingTemplate(true);
    try {
      const payload = await api.post(`/social-comments/posts/${encodeURIComponent(postId)}/template`, {
        platform: activePostPlatform || "facebook",
        ...(activeTemplate || {}),
      });
      setTemplateDraft(payload?.template || null);
      notify("emerald", "تم حفظ قالب البوست");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      notify("rose", error?.message || "تعذر حفظ قالب البوست");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handlePreviewReply = async () => {
    const actionId = resolveSocialCommentActionId(actionableComment);
    const actionCandidates = getSocialCommentActionIdCandidates(actionableComment);
    socialDebugLog("SOCIAL_COMMENT_UI_ACTION_ID_DEBUG", {
      action: "preview_reply",
      candidate_ids: actionCandidates,
      rejected_small_numeric_ids: actionCandidates.filter(({ value }) => isSmallNumericId(value)),
      resolved_id: actionId,
    });
    if (!actionId) {
      console.error("[social-comments:action-id-debug]", "No provider comment id found");
      notify("amber", "اختر تعليقًا أولًا");
      return;
    }
    if (previewLoading) return;
    setPreviewLoading(true);
    try {
      const payload = await api.post(`/social-comments/comments/${encodeURIComponent(actionId)}/auto-reply-preview`, {
        platform: activePostPlatform || "facebook",
        post_id: activePostPostId,
      });
      const renderedReply = clean(payload?.preview?.rendered_reply || payload?.preview?.renderedReply || "");
      if (renderedReply) {
        setPreviewReply(renderedReply);
        setReplyDraft(renderedReply);
        notify("emerald", "تم توليد معاينة الرد");
      } else {
        notify("amber", "لا توجد معاينة متاحة");
      }
    } catch (error) {
      notify("rose", error?.message || "تعذر توليد المعاينة");
    } finally {
      setPreviewLoading(false);
    }
  };

  const upsertOptimisticCommentEntry = useCallback((comment = {}, patch = {}) => {
    const commentId = clean(comment?.id || comment?.comment_id || comment?.external_comment_id || "");
    if (!commentId) return;
    setOptimisticCommentEntries((current) => {
      const nextEntry = {
        ...comment,
        ...patch,
        id: commentId,
        comment_id: commentId,
        external_comment_id: commentId,
        created_at: patch.created_at || comment.created_at || new Date().toISOString(),
        updated_at: patch.updated_at || comment.updated_at || new Date().toISOString(),
        automation_status: patch.automation_status || comment.automation_status || "pending",
        reply_status: patch.reply_status || comment.reply_status || "pending",
        __optimistic: true,
      };
      const index = current.findIndex((item) => clean(item.id) === commentId);
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], ...nextEntry };
        return next;
      }
      return [nextEntry, ...current];
    });
  }, []);

  const submitReply = async (comment = actionableComment, replyText = replyDraft) => {
    const actionId = resolveSocialCommentActionId(comment);
    const messageText = clean(replyText || suggestedReply);
    if (replyLoadingKey) return;
    const replyIdCandidates = getSocialCommentActionIdCandidates(comment);
    socialDebugLog("SOCIAL_COMMENT_UI_ACTION_ID_DEBUG", {
      action: "reply_send",
      candidate_ids: replyIdCandidates,
      rejected_small_numeric_ids: replyIdCandidates.filter(({ value }) => isSmallNumericId(value)),
      resolved_id: actionId,
    });
    if (!actionId) {
      console.error("[social-comments:action-id-debug]", "No provider comment id found");
      notify("amber", "اختر تعليقًا للرد");
      return;
    }
    if (!messageText) {
      notify("amber", "اكتب الرد أولًا");
      return;
    }
    upsertOptimisticCommentEntry(comment, {
      reply_status: "pending",
      automation_status: "pending",
      reply_text: messageText,
      message_text: messageText,
      rendered_reply: messageText,
      last_message: messageText,
      last_comment_text: messageText,
      last_activity_at: new Date().toISOString(),
    });
    setReplyLoadingKey(actionId);
    try {
      await api.post(`/ai-inbox/comments/${encodeURIComponent(actionId)}/reply`, {
        reply_text: messageText,
      });
      setReplyStatusOverrides((current) => ({ ...current, [actionId]: "sent" }));
      upsertOptimisticCommentEntry(comment, {
        reply_status: "sent",
        automation_status: "sent",
        updated_at: new Date().toISOString(),
      });
      notify("emerald", "تم إرسال الرد");
    } catch (error) {
      setReplyStatusOverrides((current) => ({ ...current, [actionId]: "failed" }));
      upsertOptimisticCommentEntry(comment, {
        reply_status: "failed",
        automation_status: "failed",
        error_message: error?.message || "Reply failed",
        updated_at: new Date().toISOString(),
      });
      notify("rose", error?.message || "تعذر إرسال الرد");
    } finally {
      setReplyLoadingKey("");
    }
  };

  const submitLike = async (comment = actionableComment) => {
    const actionId = resolveSocialCommentActionId(comment);
    if (likeLoadingKey) return;
    if (!actionId) {
      notify("amber", "تعذر تحديد معرف التعليق");
      return;
    }
    setLikeLoadingKey(actionId);
    setSelectedCommentKey(clean(comment?.id || actionId));
    try {
      await api.post(`/ai-inbox/comments/${encodeURIComponent(actionId)}/like`, {});
      setLikeStatusOverrides((current) => ({ ...current, [clean(comment?.id || actionId)]: "sent", [actionId]: "sent" }));
      upsertOptimisticCommentEntry(comment, {
        like_status: "sent",
        updated_at: new Date().toISOString(),
      });
      notify("emerald", "تم تسجيل الإعجاب على التعليق");
    } catch (error) {
      setLikeStatusOverrides((current) => ({ ...current, [clean(comment?.id || actionId)]: "failed", [actionId]: "failed" }));
      notify("rose", error?.message || "تعذر تسجيل الإعجاب على التعليق");
    } finally {
      setLikeLoadingKey("");
    }
  };

  const prepareCommentComposer = useCallback((comment = {}, mode = "reply") => {
    const key = clean(comment?.id || comment?.comment_id || comment?.external_comment_id || "");
    if (key) setSelectedCommentKey(key);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    });
    notify("amber", mode === "private_message" ? "اكتب الرسالة ثم اضغط إرسال رسالة خاصة" : "اكتب الرد ثم اضغط إرسال الرد");
  }, []);

  const submitPrivateMessage = async (comment = actionableComment, messageText = replyDraft || suggestedReply) => {
    const clickedComment = comment || actionableComment || null;
    const actionId = resolveSocialCommentActionId(clickedComment);
    const loadingKey = clean(clickedComment?.id || "");
    const actionCandidates = getSocialCommentActionIdCandidates(comment);
    const finalMessage = clean(messageText);
    if (privateMessageLoadingKey) return;
    if (!finalMessage) {
      notify("amber", "اكتب رسالة خاصة أولًا");
      return;
    }
    if (!supportsPrivateMessage(clickedComment, activePostPlatform)) {
      notify("amber", "الرسائل الخاصة مدعومة فقط لتعليقات Facebook وInstagram");
      return;
    }
    const debugData = getSocialCommentActionDebugData(clickedComment);
    socialDebugLog("SOCIAL_COMMENT_UI_PRIVATE_ACTION_CLICK", {
      ...debugData,
      resolved_id: actionId,
    });
    socialDebugLog("SOCIAL_COMMENT_UI_ACTION_ID_DEBUG", {
      action: "private_message",
      candidate_ids: actionCandidates,
      rejected_small_numeric_ids: actionCandidates.filter(({ value }) => isSmallNumericId(value)),
      resolved_id: actionId,
    });
    if (!actionId) {
      console.error("[social-comments:action-id-debug]", "No provider comment id found");
      notify("amber", "تعذر تحديد معرف التعليق");
      return;
    }
    if (loadingKey) setSelectedCommentKey(loadingKey);
    setPrivateMessageLoadingKey(loadingKey || actionId);
    upsertOptimisticCommentEntry(clickedComment || {}, {
      reply_status: "pending",
      automation_status: "pending",
      private_reply_status: "pending",
      message_text: finalMessage,
      rendered_private_reply: finalMessage,
      last_activity_at: new Date().toISOString(),
    });
    try {
      const commentPlatform = clean(clickedComment?.platform || clickedComment?.raw?.platform || activePostPlatform || "facebook");
      await api.post(`/ai-inbox/comments/${encodeURIComponent(actionId)}/private-message`, {
        message: finalMessage,
        platform: commentPlatform,
        post_id: activePostPostId,
      });
      const statusKey = loadingKey || actionId;
      setPrivateMessageStatusOverrides((current) => ({ ...current, [statusKey]: "sent" }));
      upsertOptimisticCommentEntry(clickedComment || {}, {
        reply_status: "sent",
        automation_status: "sent",
        private_reply_status: "sent",
        updated_at: new Date().toISOString(),
      });
      notify("emerald", "تم إرسال الرسالة الخاصة");
    } catch (error) {
      const statusKey = loadingKey || actionId;
      setPrivateMessageStatusOverrides((current) => ({ ...current, [statusKey]: "failed" }));
      upsertOptimisticCommentEntry(clickedComment || {}, {
        reply_status: "failed",
        automation_status: "failed",
        private_reply_status: "failed",
        error_message: error?.message || "Private message failed",
        updated_at: new Date().toISOString(),
      });
      notify("rose", error?.message || "إرسال رسالة خاصة من التعليق يحتاج صلاحية/دعم Meta، استخدم فتح البوست مؤقتًا.");
    } finally {
      const statusKey = loadingKey || actionId;
      setPrivateMessageLoadingKey((current) => (current === statusKey ? "" : current));
    }
  };

  const handleIgnoreComment = async (comment = actionableComment) => {
    const commentId = clean(comment?.id || "");
    if (!commentId) {
      notify("amber", "اختر تعليقًا للتجاهل");
      return;
    }
    setIgnoreLoadingKey(commentId);
    setIgnoredCommentKeys((current) => {
      const next = new Set(current);
      next.add(commentId);
      return next;
    });
    try {
      await api.post(`/social-comments/comments/${encodeURIComponent(commentId)}/ignore`, {
        platform: activePostPlatform || "facebook",
        post_id: activePostPostId,
        reason: "ignore",
      });
      notify("emerald", "تم تجاهل التعليق");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      setIgnoredCommentKeys((current) => {
        const next = new Set(current);
        next.delete(commentId);
        return next;
      });
      notify("rose", error?.message || "تعذر تجاهل التعليق");
    } finally {
      setIgnoreLoadingKey("");
    }
  };

  const handleCreateLead = async (comment = actionableComment) => {
    const commentId = clean(comment?.id || "");
    setLeadLoadingKey(commentId || "lead");
    try {
      notify("amber", "سيتم ربطها بالـ CRM لاحقًا");
    } finally {
      window.setTimeout(() => setLeadLoadingKey(""), 150);
    }
  };

  const handleSendProduct = () => {
    notify("amber", "الميزة قيد التجهيز");
  };

  const firstMatchingComment = (predicate) => visibleComments.find(predicate) || actionableComment || null;
  const useVirtualPosts = normalizedPosts.length > 50;

  const renderCommentTags = (comment = {}) => {
    const tags = getCommentTags(comment);
    if (!tags.length) return null;
    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
              tag === "Price"
                ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-100"
                : tag === "Size"
                  ? "border-violet-300/20 bg-violet-400/10 text-violet-100"
                  : tag === "Shipping"
                    ? "border-amber-300/20 bg-amber-400/10 text-amber-100"
                    : tag === "Lead"
                      ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                      : tag === "Review"
                        ? "border-sky-300/20 bg-sky-400/10 text-sky-100"
                        : "border-white/10 bg-white/[0.04] text-slate-300"
            }`}
          >
            {tag}
          </span>
        ))}
      </div>
    );
  };

  if (streamlined) {
    const platformFilterButtons = [
      { key: "all", label: t("aiSupport.inbox.filters.all") },
      { key: "facebook", label: "Facebook" },
      { key: "instagram", label: "Instagram" },
    ];
    const postPlatforms = (post) => {
      const values = asArray(post.platforms).length ? post.platforms : [post.platform];
      return Array.from(new Set(values.map((value) => clean(value).toLowerCase()).filter((value) => value === "facebook" || value === "instagram")));
    };
    return (
      <section className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 text-white shadow-[0_16px_50px_rgba(0,0,0,0.22)]">
        <div className="grid h-full min-h-0 w-full min-w-0 gap-2 p-2 min-[960px]:grid-cols-[300px_minmax(0,1fr)] min-[1440px]:grid-cols-[326px_minmax(0,1fr)]">
          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-slate-950/60">
            <div className="flex min-h-[86px] flex-col justify-center gap-2 border-b border-white/10 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.posts")}</div>
                <div className="mt-0.5 text-[11px] font-semibold text-slate-400">
                  {t("aiSupport.inbox.socialWorkspace.commentsCount", { count: normalizedPosts.reduce((sum, post) => sum + Number(post.commentsCount || 0), 0) })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={loading || refreshing}
                aria-label={t("aiSupport.inbox.socialWorkspace.refresh")}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-200 disabled:opacity-50"
              >
                {loading || refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/20 p-1">
                {platformFilterButtons.map((filterItem) => (
                  <button key={filterItem.key} type="button" onClick={() => onPostPlatformFilterChange?.(filterItem.key)} className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[10px] font-black transition ${postPlatformFilter === filterItem.key ? "bg-[#a47a12] text-white" : "text-slate-400 hover:bg-white/[0.05]"}`}>
                    {filterItem.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
              {!normalizedPosts.length && !loading ? (
                <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-5 text-center">
                  <div>
                    <MessageSquareText className="mx-auto h-6 w-6 text-slate-500" />
                    <div className="mt-3 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.noPosts")}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{t("aiSupport.inbox.socialWorkspace.noPostsHint")}</div>
                  </div>
                </div>
              ) : null}

              {normalizedPosts.map((post) => {
                const key = postKey(post);
                const active = activePostKey === key;
                const visibleTime = getPostVisibleTime(post);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleSelectCardPost(post, key)}
                    onMouseEnter={() => onPrefetchPost?.(post.raw || post, key)}
                    className={`flex w-full items-start gap-2.5 rounded-2xl border p-2.5 text-start transition ${
                      active
                        ? "border-[#a47a12]/70 bg-[#a47a12]/20 ring-1 ring-[#a47a12]/20"
                        : "border-white/10 bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.055]"
                    }`}
                  >
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                      {post.thumbnailUrl ? (
                        <img src={post.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-slate-500"><ImageIcon className="h-4 w-4" /></div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="line-clamp-2 text-xs font-black leading-5 text-white">{post.caption || t("aiSupport.inbox.socialWorkspace.posts")}</div>
                        {Number(post.newCount || 0) > 0 ? (
                          <span className="inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-[#d9aa20] px-1.5 py-0.5 text-[9px] font-black text-slate-950">{post.newCount}</span>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                        {postPlatforms(post).map((platform) => {
                          const meta = platformMeta(platform);
                          return <span key={platform} className={`rounded-full border px-2 py-0.5 ${meta.className}`}>{meta.label}</span>;
                        })}
                        <span>{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: post.commentsCount || 0 })}</span>
                        {visibleTime ? <span>{absoluteTime(visibleTime)}</span> : null}
                      </div>
                    </div>
                  </button>
                );
              })}

              {onLoadMore && nextCursor ? (
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-black text-slate-200 disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t("aiSupport.inbox.socialWorkspace.loadMore")}
                </button>
              ) : null}
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[20px] border border-white/10 bg-[#1f201e]">
            <header className="flex min-h-[62px] items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-white/10 bg-white/[0.04]">
                  {activePostImage ? <img src={activePostImage} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-slate-500"><MessageSquareText className="h-4 w-4" /></div>}
                </div>
                <div className="min-w-0">
                  <h2 className="line-clamp-1 text-sm font-black text-white">{activePostCaption || t("aiSupport.inbox.socialWorkspace.noPosts")}</h2>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                    {postPlatforms(activePostDetails).map((platform) => {
                      const meta = platformMeta(platform);
                      return <span key={platform} className={`rounded-full border px-2 py-0.5 ${meta.className}`}>{meta.label}</span>;
                    })}
                    <span>{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: displayComments.length })}</span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenPost}
                disabled={!activePostLink || openingPost}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 disabled:opacity-40"
              >
                {openingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {t("aiSupport.inbox.socialWorkspace.openPost")}
              </button>
            </header>

            <div className="flex items-center justify-center gap-1 border-b border-white/10 bg-black/10 px-3 py-2">
              {platformFilterButtons.map((filterItem) => (
                <button key={filterItem.key} type="button" onClick={() => onCommentPlatformFilterChange?.(filterItem.key)} className={`rounded-full border px-3 py-1 text-[10px] font-black transition ${commentPlatformFilter === filterItem.key ? "border-[#d9aa20]/70 bg-[#a47a12]/30 text-[#f2cb58]" : "border-white/10 bg-white/[0.03] text-slate-400"}`}>
                  {filterItem.label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              {activeThread.error ? <div className="mb-3 rounded-xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold text-rose-100">{activeThread.error}</div> : null}
              {activeThread.loading && !commentsToRender.length ? (
                <div className="grid h-full place-items-center"><Loader2 className="h-6 w-6 animate-spin text-[#d9aa20]" /></div>
              ) : null}
              {!displayComments.length && !activeThread.loading ? (
                <div className="grid h-full min-h-64 place-items-center text-center">
                  <div>
                    <MessageSquareText className="mx-auto h-7 w-7 text-slate-600" />
                    <div className="mt-3 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.noComments")}</div>
                    <div className="mt-1 text-xs text-slate-500">{t("aiSupport.inbox.socialWorkspace.noCommentsHint")}</div>
                  </div>
                </div>
              ) : null}

              <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
                {hasMoreComments ? (
                  <button type="button" onClick={() => setCommentWindowSize((current) => Math.min(displayComments.length, current + 50))} className="mx-auto rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-black text-slate-300">
                    {t("aiSupport.inbox.socialWorkspace.loadOlderComments")}
                  </button>
                ) : null}
                {commentsToRender.map((comment) => {
                  const selected = comment.id === selectedCommentKey;
                  const attachmentPreview = getCommentAttachmentImage(comment.raw || comment);
                  const replyText = clean(comment.replyText || comment.raw?.reply_text || comment.raw?.rendered_reply || "");
                  return (
                    <div key={comment.id || comment.createdTime} ref={(node) => registerCommentNode(comment.id, node)} className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCommentKey(comment.id)}
                        className={`max-w-[78%] self-start rounded-2xl border px-3.5 py-3 text-start transition ${selected ? "border-[#d9aa20]/60 bg-[#2d2b23] ring-1 ring-[#d9aa20]/20" : "border-white/10 bg-[#292a27] hover:border-white/20"}`}
                      >
                        <div className="flex items-center gap-2">
                          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-white/[0.06]">
                            {comment.customerAvatar ? <img src={comment.customerAvatar} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center"><UserRound className="h-3.5 w-3.5 text-slate-400" /></div>}
                          </div>
                          <span className="min-w-0 truncate text-xs font-black text-white">{comment.customerName || "عميل"}</span>
                          {comment.platform ? (() => { const meta = platformMeta(comment.platform); return <span className={`rounded-full border px-1.5 py-0.5 text-[8px] ${meta.className}`}>{meta.label}</span>; })() : null}
                          <span className="text-[9px] font-semibold text-slate-500">{comment.createdTime ? absoluteTime(comment.createdTime) : ""}</span>
                        </div>
                        <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-100">{comment.message || "—"}</div>
                        {attachmentPreview ? <img src={attachmentPreview} alt="" className="mt-2 max-h-52 rounded-xl object-cover" loading="lazy" /> : null}
                      </button>
                      {replyText ? (
                        <div className="max-w-[78%] self-end rounded-2xl border border-emerald-300/20 bg-emerald-950/55 px-3.5 py-3 text-start">
                          <div className="text-[10px] font-black text-emerald-300">{t("aiSupport.inbox.socialWorkspace.sent")}</div>
                          <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-white">{replyText}</div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <footer className="border-t border-white/10 bg-[#191a18] p-2.5">
              <div className="flex items-end gap-2 rounded-2xl border border-[#a47a12]/55 bg-[#22231f] p-1.5 focus-within:border-[#d9aa20]">
                <textarea
                  ref={composerRef}
                  value={replyDraft}
                  onChange={(event) => setReplyDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submitReply(actionableComment, replyDraft);
                    }
                  }}
                  rows={1}
                  className="max-h-28 min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-3 py-2 text-sm leading-6 text-white outline-none"
                  placeholder={t("aiSupport.inbox.socialWorkspace.replyDraft")}
                />
                <button
                  type="button"
                  onClick={() => void submitReply(actionableComment, replyDraft)}
                  disabled={!actionableComment || !clean(replyDraft) || Boolean(replyLoadingKey)}
                  aria-label={t("aiSupport.inbox.socialWorkspace.reply")}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#a47a12] text-white transition hover:bg-[#c39418] disabled:opacity-40"
                >
                  {replyLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </footer>
          </main>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/55 text-white shadow-[0_16px_50px_rgba(0,0,0,0.22)] backdrop-blur">
      <div className="grid h-full min-h-0 w-full min-w-0 gap-2.5 p-2.5 min-[1024px]:grid-cols-[312px_minmax(0,1fr)] min-[1440px]:grid-cols-[336px_minmax(0,1fr)]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/60 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">{t("aiSupport.inbox.socialWorkspace.socialComments")}</div>
              <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.posts")}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={loading || refreshing}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-[11px] font-black text-white shadow-sm disabled:opacity-50"
            >
              {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {t("aiSupport.inbox.socialWorkspace.refresh")}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
            {!normalizedPosts.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.noPosts")}</div>
                <div className="mt-1 text-xs text-slate-400">{t("aiSupport.inbox.socialWorkspace.noPostsHint")}</div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              {useVirtualPosts ? (
                <VirtualList
                  items={normalizedPosts}
                  estimateSize={176}
                  overscan={8}
                  className="max-h-[calc(100vh-14rem)] overflow-y-auto pr-1"
                  itemKey={(post, index) => postKey(post) || index}
                  renderItem={(post) => {
                    const key = postKey(post);
                    const active = activePostKey === key;
                    const meta = platformMeta(post.platform);
                    const thumb = post.thumbnailUrl;
                    const hasVisibleProductLink = Boolean(
                      post.hasDirectProductLink ||
                      post.has_direct_product_link ||
                      Number(post.linkedProductsCount || post.linked_products_count || 0) > 0 ||
                      ["direct", "v2_direct"].includes(clean(post.productLinkSource || post.product_link_source || ""))
                    );
                    socialDebugLog("SOCIAL_POST_CARD_ID_TRACE", {
                      card_post_id: clean(post?.postId || ""),
                      card_platform_post_id: clean(post?.platformPostId || ""),
                      card_canonical_post_id: clean(post?.canonicalPostId || ""),
                      card_permalink_url: clean(post?.permalinkUrl || ""),
                      card_image_url: clean(thumb || ""),
                      selected_post_id: clean(activePost?.postId || activePost?.canonicalPostId || ""),
                      open_post_url: clean(resolvePostOpenLink(post, normalizeSocialPostDisplay(post)).finalUrl || ""),
                    });
                    socialDebugLog("SOCIAL_POST_CARD_PRODUCT_LINK_TRACE", {
                      canonical_post_id: clean(post?.canonicalPostId || ""),
                      platform_post_id: clean(post?.platformPostId || post?.postId || ""),
                      displayed_product_name: clean(post?.directPrimaryLinkedProduct?.name || post?.directPrimaryLinkedProduct?.title || post?.directPrimaryLinkedProduct?.product_name || ""),
                      product_link_source: clean(post?.productLinkSource || "none"),
                      has_direct_product_link: Boolean(post?.hasDirectProductLink),
                      has_sibling_product_context: Boolean(post?.hasSiblingProductContext),
                    });
                    socialDebugLog("SOCIAL_DIRECT_LINK_READBACK_TRACE", {
                      card_key: key,
                      row_post_identity: {
                        platform_post_id: clean(post?.platformPostId || ""),
                        source_post_id: clean(post?.sourcePostId || ""),
                        permalink_post_id: clean(post?.permalinkPostId || ""),
                        canonical_post_id: clean(post?.canonicalPostId || ""),
                      },
                      link_row_identity: {
                        platform_post_id: clean(post?.directPrimaryLinkedProduct?.platform_post_id || ""),
                      },
                      product_name: clean(post?.directPrimaryLinkedProduct?.name || post?.directPrimaryLinkedProduct?.title || post?.directPrimaryLinkedProduct?.product_name || ""),
                      accepted: Boolean(post?.hasDirectProductLink || ["direct", "v2_direct"].includes(clean(post?.productLinkSource || "none"))),
                      rejected_reason: clean(post?.hasDirectProductLink ? "" : (post?.hasSiblingProductContext ? "sibling_only" : "no_direct_link")),
                      product_link_source: clean(post?.productLinkSource || "none"),
                      has_direct_product_link: Boolean(post?.hasDirectProductLink),
                    });
                    logCardKeyParity(post);
                    let hoverTimer = null;
                    const schedulePrefetch = () => {
                      if (!onPrefetchPost) return;
                      if (hoverTimer) window.clearTimeout(hoverTimer);
                      hoverTimer = window.setTimeout(() => onPrefetchPost(post.raw || post, key), 300);
                    };
                    const clearPrefetch = () => {
                      if (!hoverTimer) return;
                      window.clearTimeout(hoverTimer);
                      hoverTimer = null;
                    };
                    return (
                      <article
                        key={key}
                        role={onSelectPost ? "button" : undefined}
                        tabIndex={onSelectPost ? 0 : undefined}
                        onClick={onSelectPost ? () => handleSelectCardPost(post, key) : undefined}
                        onMouseEnter={onPrefetchPost ? schedulePrefetch : undefined}
                        onMouseLeave={onPrefetchPost ? clearPrefetch : undefined}
                        onFocus={onPrefetchPost ? schedulePrefetch : undefined}
                        onBlur={onPrefetchPost ? clearPrefetch : undefined}
                        onKeyDown={
                          onSelectPost
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") onSelectPost(post, key);
                              }
                            : undefined
                        }
                        className={`rounded-2xl border p-2.5 transition shadow-[0_8px_24px_rgba(0,0,0,0.16)] ${
                          active ? "border-cyan-300/30 bg-white/[0.08] ring-1 ring-cyan-300/20" : "border-white/10 bg-white/[0.04] hover:border-white/20"
                        }`}
                        style={{ minHeight: "176px" }}
                      >
                        <div className="flex gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                            {thumb ? (
                              <img key={`${clean(post?.canonicalPostId || key)}:${clean(thumb)}`} src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="grid h-full w-full place-items-center bg-white/[0.04] text-slate-400">
                                <div className="flex flex-col items-center gap-1">
                                  <ImageIcon className="h-4 w-4" />
                                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-black tracking-[0.08em] text-slate-400">
                                    {t("aiSupport.inbox.socialWorkspace.noImage")}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm font-black leading-6 text-white">{post.caption || "Post"}</div>
                              </div>
                              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
                              <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: post.commentsCount })}</span>
                              <span className={`rounded-full border px-2.5 py-1 ${post.newCount > 0 ? "border-amber-300/20 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>{t("aiSupport.inbox.socialWorkspace.newCount", { count: post.newCount })}</span>
                              <span
                                title={t(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).hintKey)}
                                className={`rounded-full border px-2.5 py-1 ${automationToneClass(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).tone)}`}
                              >
                                {t(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).labelKey)}
                              </span>
                              {hasVisibleProductLink ? (
                                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-100">
                                ✓ {post.directPrimaryLinkedProduct?.name || post.directPrimaryLinkedProduct?.title || post.directPrimaryLinkedProduct?.product_name || "Linked Product"}
                                {post.directLinkedProductsCount > 1 ? ` +${post.directLinkedProductsCount - 1}` : ""}
                              </span>
                            ) : (
                              <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">{t("aiSupport.inbox.socialWorkspace.noProductLinkedWarning")}</span>
                            )}
                              {postTypeMeta(post) ? <span className={`rounded-full border px-2.5 py-1 ${postTypeMeta(post).className}`}>{postTypeMeta(post).label}</span> : null}
                              {post.needsReply ? <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">{t("aiSupport.inbox.socialWorkspace.needsReply")}</span> : null}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenAutomationDrawer(post, key);
                                }}
                                className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-slate-200"
                              >
                                {t("aiSupport.inbox.socialWorkspace.automation")}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenProductLinksDrawer(post, key);
                                }}
                                className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-100"
                              >
                                {t("aiSupport.inbox.socialWorkspace.linkProducts")}
                              </button>
                            </div>
                            <div className="mt-2 text-[11px] font-medium text-slate-400">
                              {(() => {
                                const visibleTime = getPostVisibleTime(post);
                                return (
                                  <span className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-slate-600">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {visibleTime ? absoluteTime(visibleTime) : dash}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  }}
                />
              ) : (
                normalizedPosts.map((post) => {
                  const key = postKey(post);
                  const active = activePostKey === key;
                  const meta = platformMeta(post.platform);
                  const thumb = post.thumbnailUrl;
                  const hasVisibleProductLink = Boolean(
                    post.hasDirectProductLink ||
                    post.has_direct_product_link ||
                    Number(post.linkedProductsCount || post.linked_products_count || 0) > 0 ||
                    ["direct", "v2_direct"].includes(clean(post.productLinkSource || post.product_link_source || ""))
                  );
                  socialDebugLog("SOCIAL_POST_CARD_ID_TRACE", {
                    card_post_id: clean(post?.postId || ""),
                    card_platform_post_id: clean(post?.platformPostId || ""),
                    card_canonical_post_id: clean(post?.canonicalPostId || ""),
                    card_permalink_url: clean(post?.permalinkUrl || ""),
                    card_image_url: clean(thumb || ""),
                    selected_post_id: clean(activePost?.postId || activePost?.canonicalPostId || ""),
                    open_post_url: clean(resolvePostOpenLink(post, normalizeSocialPostDisplay(post)).finalUrl || ""),
                  });
                  socialDebugLog("SOCIAL_POST_CARD_PRODUCT_LINK_TRACE", {
                    canonical_post_id: clean(post?.canonicalPostId || ""),
                    platform_post_id: clean(post?.platformPostId || post?.postId || ""),
                    displayed_product_name: clean(post?.directPrimaryLinkedProduct?.name || post?.directPrimaryLinkedProduct?.title || post?.directPrimaryLinkedProduct?.product_name || ""),
                    product_link_source: clean(post?.productLinkSource || "none"),
                    has_direct_product_link: Boolean(post?.hasDirectProductLink),
                    has_sibling_product_context: Boolean(post?.hasSiblingProductContext),
                  });
                  socialDebugLog("SOCIAL_DIRECT_LINK_READBACK_TRACE", {
                    card_key: key,
                    row_post_identity: {
                      platform_post_id: clean(post?.platformPostId || ""),
                      source_post_id: clean(post?.sourcePostId || ""),
                      permalink_post_id: clean(post?.permalinkPostId || ""),
                      canonical_post_id: clean(post?.canonicalPostId || ""),
                    },
                    link_row_identity: {
                      platform_post_id: clean(post?.directPrimaryLinkedProduct?.platform_post_id || ""),
                    },
                    product_name: clean(post?.directPrimaryLinkedProduct?.name || post?.directPrimaryLinkedProduct?.title || post?.directPrimaryLinkedProduct?.product_name || ""),
                    accepted: Boolean(post?.hasDirectProductLink || ["direct", "v2_direct"].includes(clean(post?.productLinkSource || "none"))),
                    rejected_reason: clean(post?.hasDirectProductLink ? "" : (post?.hasSiblingProductContext ? "sibling_only" : "no_direct_link")),
                    product_link_source: clean(post?.productLinkSource || "none"),
                    has_direct_product_link: Boolean(post?.hasDirectProductLink),
                  });
                  logCardKeyParity(post);
                  let hoverTimer = null;
                  const schedulePrefetch = () => {
                    if (!onPrefetchPost) return;
                    if (hoverTimer) window.clearTimeout(hoverTimer);
                    hoverTimer = window.setTimeout(() => onPrefetchPost(post.raw || post, key), 300);
                  };
                  const clearPrefetch = () => {
                    if (!hoverTimer) return;
                    window.clearTimeout(hoverTimer);
                    hoverTimer = null;
                  };
                  return (
                    <article
                      key={key}
                      role={onSelectPost ? "button" : undefined}
                      tabIndex={onSelectPost ? 0 : undefined}
                      onClick={onSelectPost ? () => handleSelectCardPost(post, key) : undefined}
                      onMouseEnter={onPrefetchPost ? schedulePrefetch : undefined}
                      onMouseLeave={onPrefetchPost ? clearPrefetch : undefined}
                      onFocus={onPrefetchPost ? schedulePrefetch : undefined}
                      onBlur={onPrefetchPost ? clearPrefetch : undefined}
                      onKeyDown={
                        onSelectPost
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") handleSelectCardPost(post, key);
                            }
                          : undefined
                      }
                      className={`rounded-2xl border p-2.5 transition shadow-[0_8px_24px_rgba(0,0,0,0.16)] ${
                        active ? "border-cyan-300/30 bg-white/[0.08] ring-1 ring-cyan-300/20" : "border-white/10 bg-white/[0.04] hover:border-white/20"
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                          {thumb ? (
                            <img key={`${clean(post?.canonicalPostId || key)}:${clean(thumb)}`} src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-white/[0.04] text-slate-400">
                              <div className="flex flex-col items-center gap-1">
                                <ImageIcon className="h-4 w-4" />
                                <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-black tracking-[0.08em] text-slate-400">
                                  {t("aiSupport.inbox.socialWorkspace.noImage")}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-2 text-sm font-black leading-6 text-white">{post.caption || "Post"}</div>
                            </div>
                            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
                            <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: post.commentsCount })}</span>
                            <span className={`rounded-full border px-2.5 py-1 ${post.newCount > 0 ? "border-amber-300/20 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.05] text-slate-300"}`}>{t("aiSupport.inbox.socialWorkspace.newCount", { count: post.newCount })}</span>
                            <span
                              title={t(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).hintKey)}
                              className={`rounded-full border px-2.5 py-1 ${automationToneClass(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).tone)}`}
                            >
                              {t(resolveAutomationStateLabel({ post, config: automationSavedConfigs[key], productCount: post.directLinkedProductsCount }).labelKey)}
                            </span>
                            {hasVisibleProductLink ? (
                              <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-100">
                              ✓ {post.directPrimaryLinkedProduct?.name || post.directPrimaryLinkedProduct?.title || post.directPrimaryLinkedProduct?.product_name || "Linked Product"}
                              {post.directLinkedProductsCount > 1 ? ` +${post.directLinkedProductsCount - 1}` : ""}
                            </span>
                          ) : (
                            <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">{t("aiSupport.inbox.socialWorkspace.noProductLinkedWarning")}</span>
                            )}
                            {postTypeMeta(post) ? <span className={`rounded-full border px-2.5 py-1 ${postTypeMeta(post).className}`}>{postTypeMeta(post).label}</span> : null}
                            {post.needsReply ? <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">{t("aiSupport.inbox.socialWorkspace.needsReply")}</span> : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenAutomationDrawer(post, key);
                              }}
                                className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-slate-200"
                            >
                              {t("aiSupport.inbox.socialWorkspace.automation")}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenProductLinksDrawer(post, key);
                              }}
                                className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-cyan-100"
                            >
                              {t("aiSupport.inbox.socialWorkspace.linkProducts")}
                            </button>
                          </div>
                          <div className="mt-2 text-[11px] font-medium text-slate-400">
                            {(() => {
                              const visibleTime = getPostVisibleTime(post);
                              return (
                                <span className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] px-2.5 py-1 text-slate-300">
                                  <Clock3 className="h-3.5 w-3.5" />
                                  {visibleTime ? absoluteTime(visibleTime) : dash}
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
            {onLoadMore && nextCursor ? (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-white shadow-sm disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {t("aiSupport.inbox.socialWorkspace.loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/60 shadow-[0_10px_30px_rgba(0,0,0,0.16)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-white/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {t("aiSupport.inbox.socialWorkspace.postWorkspace")}
                  </div>
                  <h2 className="mt-1 line-clamp-1 text-xl font-black leading-7 text-white min-[1600px]:text-2xl">{activePostCaption || "اختر منشورًا من القائمة"}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePlatform.className}`}>{activePlatform.label}</span>
                    {activePostMediaBadge ? <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePostMediaBadge.className}`}>{activePostMediaBadge.label}</span> : activePostType ? <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePostType.className}`}>{activePostType.label}</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                      {t("aiSupport.inbox.socialWorkspace.commentsCount", { count: activePostDisplay?.displayCommentCount || activePost.commentsCount || 0 })}
                    </span>
                    {activePostPublishedAt ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                        <Clock3 className="h-3.5 w-3.5" />
                        {absoluteTime(activePostPublishedAt)}
                      </span>
                    ) : null}
                    {typeof activePostLikes === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">{t("aiSupport.inbox.socialWorkspace.likesCount", { count: activePostLikes })}</span> : null}
                    {typeof activePostShares === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">{t("aiSupport.inbox.socialWorkspace.sharesCount", { count: activePostShares })}</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                      {t("aiSupport.inbox.socialWorkspace.newCount", { count: activePost.newCount || 0 })}
                    </span>
                    {activePostSourceId ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-[10px] font-black text-cyan-800">
                        {t("aiSupport.inbox.socialWorkspace.activeAliasId", { id: activePostSourceId })}
                      </span>
                    ) : null}
                    {activePostConversationId ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-700">
                        {t("aiSupport.inbox.socialWorkspace.conversationId", { id: activePostConversationId })}
                      </span>
                    ) : null}
                    {activePostPostId ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-800">
                        {t("aiSupport.inbox.socialWorkspace.canonicalPostId", { id: activePostPostId })}
                      </span>
                    ) : null}
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${automationToneClass(activeAutomationState.tone)}`}>
                      {t("aiSupport.inbox.socialWorkspace.automation")}: {activeAutomationState.configId ? `${activeAutomationState.configId} · ${activeAutomationState.enabled ? t("aiSupport.inbox.socialWorkspace.enabled") : t("aiSupport.inbox.socialWorkspace.disabled")}` : t(activeAutomationState.labelKey)}
                    </span>
                    {activeProductCard.productCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                        {t("aiSupport.inbox.socialWorkspace.linkedProducts")}
                        {activeProductCard.productName ? ` · ${activeProductCard.productName}` : ""}
                        {activeProductCard.productBrand ? ` · ${activeProductCard.productBrand}` : ""}
                        {activeProductCard.productCount > 1 ? ` +${activeProductCard.productCount - 1}` : ""}
                      </span>
                  ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">
                        {t("aiSupport.inbox.socialWorkspace.noProductLinkedWarning")}
                      </span>
                  )}
                </div>
                {latestCommentMismatch ? (
                    <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-slate-800 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="inline-flex items-center gap-2 text-[11px] font-black text-amber-900">
                            <AlertTriangle className="h-4 w-4" />
                            {t("aiSupport.inbox.socialWorkspace.latestCommentDifferentPost")}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em]">
                            <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-900">{t("aiSupport.inbox.socialWorkspace.selectedId", { id: latestCommentMismatch.selectedStatusLabel || dash })}</span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-700">{t("aiSupport.inbox.socialWorkspace.latestId", { id: latestCommentMismatch.latestStatusLabel || dash })}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowLatestCommentDetails((current) => !current)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-2.5 text-[11px] font-black text-amber-900 shadow-sm"
                          >
                            {t("aiSupport.inbox.socialWorkspace.details")}
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showLatestCommentDetails ? "rotate-180" : ""}`} />
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenLatestCommentPost}
                            disabled={!latestCommentMismatch.latestCommentPermalink || openingPost}
                            title={latestCommentMismatch.latestCommentPermalink ? "" : "No permalink for latest comment post"}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-amber-200 bg-white px-2.5 text-[11px] font-black text-amber-900 shadow-sm disabled:opacity-50"
                          >
                            {openingPost ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                            {t("aiSupport.inbox.socialWorkspace.open")}
                          </button>
                          <button
                            type="button"
                            onClick={handleSwitchToLatestCommentPost}
                            disabled={!onSelectPost || !latestCommentMismatch.hasResolvedLatestPost}
                            title={latestCommentMismatch.hasResolvedLatestPost ? "" : "No latest post found in the current post list"}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-[11px] font-black text-slate-900 shadow-sm disabled:opacity-50"
                          >
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            {t("aiSupport.inbox.socialWorkspace.switch")}
                          </button>
                          <button
                            type="button"
                            onClick={handleLinkLatestCommentPost}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-2.5 text-[11px] font-black text-cyan-800 shadow-sm"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            {t("aiSupport.inbox.socialWorkspace.link")}
                          </button>
                        </div>
                      </div>
                      {showLatestCommentDetails ? (
                        <div className="mt-2 grid gap-2 text-[11px] text-slate-700 sm:grid-cols-2">
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.selectedPostId")}</div>
                            <div className="mt-1 break-all font-semibold text-slate-900">{latestCommentMismatch.selectedPostId || dash}</div>
                            <div className="mt-1 text-[11px] font-semibold text-emerald-700">{t("aiSupport.inbox.socialWorkspace.selectedPost", { status: latestCommentMismatch.selectedStatusLabel || dash })}</div>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.latestCommentPostId")}</div>
                            <div className="mt-1 break-all font-semibold text-slate-900">{latestCommentMismatch.latestCommentPostId || dash}</div>
                            <div className="mt-1 text-[11px] font-semibold text-amber-700">{t("aiSupport.inbox.socialWorkspace.latestCommentPost", { status: latestCommentMismatch.latestStatusLabel || dash })}</div>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.selectedPermalink")}</div>
                            <div className="mt-1 break-all font-medium text-slate-700">{latestCommentMismatch.selectedPermalink || dash}</div>
                          </div>
                          <div className="rounded-xl border border-amber-200 bg-white px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.latestCommentPermalink")}</div>
                            <div className="mt-1 break-all font-medium text-slate-700">{latestCommentMismatch.latestCommentPermalink || dash}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenAutomationDrawer(activePostDetails, activePostKey)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-900 shadow-sm"
                >
                  <Bot className="h-4 w-4" />
                  {t("aiSupport.inbox.socialWorkspace.automation")}
                </button>
                <button
                  type="button"
                  onClick={handleOpenPost}
                  disabled={!activePostLink || openingPost}
                  title={activePostLink ? "" : "No Facebook permalink available"}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-900 shadow-sm disabled:opacity-50"
                >
                  {openingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  {t("aiSupport.inbox.socialWorkspace.openPost")}
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-2.5 p-3 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,328px)]">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden min-[1280px]:max-h-[calc(100vh-220px)]">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
                  <button
                    type="button"
                    onClick={handleOpenPost}
                    disabled={!activePostLink || openingPost}
                    className="group relative flex h-[170px] items-center justify-center overflow-hidden bg-slate-100 text-left outline-none min-[1600px]:h-[190px] disabled:cursor-default"
                  >
                    {activePostImage ? (
                      <img src={activePostImage} alt="" className="h-full w-full object-contain bg-slate-100 p-3" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-slate-100 text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                            <Sparkles className="h-6 w-6 text-cyan-100" />
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-black tracking-[0.12em] text-slate-200">
                            {t("aiSupport.inbox.socialWorkspace.noImage")}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/75 via-slate-900/10 to-transparent" />
                    <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3.5">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/85 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-slate-900 shadow-[0_6px_18px_rgba(15,23,42,0.12)] backdrop-blur">
                        {activePlatform.label}
                        {activePostMediaBadge ? <span className={`rounded-full border px-2 py-0.5 ${activePostMediaBadge.className}`}>{activePostMediaBadge.label}</span> : null}
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleOpenPost();
                        }}
                        disabled={!activePostLink || openingPost}
                        title={activePostLink ? "" : "No Facebook permalink available"}
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/20 bg-white/90 px-3 text-[11px] font-black text-slate-900 shadow-sm disabled:opacity-50"
                      >
                        {openingPost ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                        {t("aiSupport.inbox.socialWorkspace.openPost")}
                      </button>
                    </div>
                  </button>

                  <div className="space-y-2.5 p-3.5">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: activePost.commentsCount || 0 })}</span>
                      {typeof activePostLikes === "number" ? <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.likesCount", { count: activePostLikes })}</span> : null}
                      {typeof activePostShares === "number" ? <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.sharesCount", { count: activePostShares })}</span> : null}
                      {activePostPublishedAt ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-slate-600">
                          <Clock3 className="h-3.5 w-3.5" />
                          {absoluteTime(activePostPublishedAt)}
                        </span>
                      ) : null}
                    </div>

                    <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-2 shadow-[0_10px_30px_rgba(0,0,0,0.14)]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.erpProductCard")}</div>
                          <div className="mt-1 text-sm font-black text-white">{activeProductCard.productName || t("aiSupport.inbox.socialWorkspace.linkedProduct")}</div>
                          <div className="mt-1 text-xs font-semibold text-slate-500">
                            {activeProductCard.productBrand || dash}
                            {activeProductCard.productCount > 0 ? ` · ${activeProductCard.productCount} linked` : ""}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowProductCardDetails((current) => !current)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-white px-2.5 text-[11px] font-black text-slate-900 shadow-sm"
                          >
                            {showProductCardDetails ? t("aiSupport.inbox.socialWorkspace.collapse") : t("aiSupport.inbox.socialWorkspace.expand")}
                          </button>
                          {activeProductCard.productLink ? (
                            <a
                              href={activeProductCard.productLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-2.5 text-[11px] font-black text-slate-900 shadow-sm"
                            >
                              {t("aiSupport.inbox.socialWorkspace.productLink")}
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="inline-flex h-8 items-center rounded-xl border border-dashed border-[#E2E8F0] bg-white px-2.5 text-[11px] font-black text-slate-400">
                              {t("aiSupport.inbox.socialWorkspace.noProductLink")}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.priceValue", { value: activeProductCard.priceValue || dash })}</span>
                        <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{t("aiSupport.inbox.socialWorkspace.stockValue", { value: activeProductCard.stockValue || dash })}</span>
                      </div>
                      {showProductCardDetails ? (
                        <div className="mt-3 space-y-3">
                          {activeProductCard.productImage ? (
                            <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                              <img src={activeProductCard.productImage} alt="" className="h-24 w-full object-cover" loading="lazy" />
                            </div>
                          ) : null}
                          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                            <InfoChip label={t("aiSupport.inbox.ui.sale")} value={activeProductCard.salePriceValue || dash} />
                            <InfoChip label={t("aiSupport.inbox.ui.sizes")} value={activeProductCard.sizesValue || dash} />
                            <InfoChip label={t("aiSupport.inbox.ui.colors")} value={activeProductCard.colorsValue || dash} />
                            <InfoChip label={t("aiSupport.inbox.ui.product")} value={activeProductCard.productCount > 0 ? `${activeProductCard.productCount} linked` : dash} />
                          </div>
                        </div>
                      ) : null}
                    </div>

                  </div>
                </div>

                <div className="flex min-h-[420px] flex-1 flex-col gap-3 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.ui.commentsTimeline")}</div>
                      <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.commentsCount", { count: displayComments.length })}</div>
                      <div className="mt-1 text-xs text-slate-500">{t("aiSupport.inbox.socialWorkspace.timelineHint")}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasMoreComments ? (
                        <button
                          type="button"
                          onClick={() => setCommentWindowSize((current) => Math.min(displayComments.length, current + 50))}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200"
                        >
                          {t("aiSupport.inbox.socialWorkspace.loadOlderComments")}
                          <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px]">
                            +{Math.min(50, displayComments.length - commentsToRender.length)}
                          </span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void handleRefresh()}
                        disabled={refreshing || activeThread.loading}
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                      >
                        {refreshing || activeThread.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                        {t("aiSupport.inbox.socialWorkspace.reload")}
                      </button>
                    </div>
                  </div>

                  {activeThread.error ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold leading-6 text-rose-100">{activeThread.error}</div>
                  ) : null}

                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {activeThread.loading && !commentsToRender.length ? (
                      <div className="grid min-h-[18rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-6 text-center">
                        <div className="space-y-3">
                          <div className="mx-auto h-4 w-40 rounded-full bg-white/10" />
                          <div className="mx-auto h-3 w-56 rounded-full bg-white/10" />
                          <div className="mx-auto h-3 w-48 rounded-full bg-white/10" />
                          <div className="mx-auto mt-4 h-12 w-12 animate-pulse rounded-2xl border border-white/10 bg-white/[0.05]" />
                        </div>
                      </div>
                    ) : null}

                    {!displayComments.length && !activeThread.loading ? (
                      <div className="grid min-h-[18rem] place-items-center rounded-[22px] border border-dashed border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-6 text-center">
                        <div>
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-400">
                            <MessageSquareText className="h-5 w-5" />
                          </div>
                          <div className="mt-3 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.noComments")}</div>
                          <div className="mt-1 text-xs text-slate-500">{t("aiSupport.inbox.socialWorkspace.noCommentsHint")}</div>
                          <button
                            type="button"
                            onClick={() => void handleRefresh()}
                            disabled={refreshing}
                            className="mt-4 inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                          >
                            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            {t("aiSupport.inbox.socialWorkspace.reloadComments")}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {commentsToRender.map((comment) => (
                      <SocialCommentsWorkspaceCommentRow
                        key={comment.id || `${comment.createdTime || ""}:comment`}
                        comment={comment}
                        selectedCommentKey={selectedCommentKey}
                        highlightedCommentKey={highlightedCommentKey}
                        activePostPlatform={activePostPlatform}
                        replyDraft={replyDraft}
                        previewReply={previewReply}
                        suggestedReply={suggestedReply}
                        replyLoadingKey={replyLoadingKey}
                        likeLoadingKey={likeLoadingKey}
                        likeStatus={clean(likeStatusOverrides[comment.id] || comment.like_status || comment.raw?.like_status || "")}
                        privateMessageLoadingKey={privateMessageLoadingKey}
                        privateMessageStatus={clean(privateMessageStatusOverrides[comment.id] || "")}
                        leadLoadingKey={leadLoadingKey}
                        ignoreLoadingKey={ignoreLoadingKey}
                        onSelectComment={setSelectedCommentKey}
                        onSelectCustomer={onSelectCustomer}
                        onLike={submitLike}
                        onCompose={prepareCommentComposer}
                        onReply={submitReply}
                        onPrivateMessage={submitPrivateMessage}
                        onCreateLead={handleCreateLead}
                        onIgnore={handleIgnoreComment}
                        registerCommentNode={registerCommentNode}
                      />
                    ))}
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.replyComposer")}</div>
                        <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.draftReply")}</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePreviewReply()}
                          disabled={previewLoading || !actionableComment}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                        >
                          {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          {t("aiSupport.inbox.socialWorkspace.previewReply")}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopySuggestedReply()}
                          disabled={!clean(suggestedReply)}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                          {t("aiSupport.inbox.socialWorkspace.copySuggestedReply")}
                        </button>
                      </div>
                    </div>

                    <textarea
                      ref={composerRef}
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={2}
                      className="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-5 text-white outline-none"
                      placeholder={t("aiSupport.inbox.socialWorkspace.replyDraft")}
                    />

                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void submitReply(actionableComment, replyDraft || previewReply || suggestedReply)}
                        disabled={!actionableComment || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                      >
                        {replyLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {t("aiSupport.inbox.socialWorkspace.sendSuggestedReply")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitPrivateMessage(actionableComment, replyDraft || previewReply || suggestedReply)}
                        disabled={!actionableComment || !supportsPrivateMessage(actionableComment, activePostPlatform) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(privateMessageLoadingKey)}
                        title={supportsPrivateMessage(actionableComment, activePostPlatform) ? "" : "Private messages are only supported for Facebook and Instagram comments"}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        {privateMessageLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                        {activePrivateMessageStatus === "sent" ? t("aiSupport.inbox.socialWorkspace.sent") : t("aiSupport.inbox.socialWorkspace.privateMessage")}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!replyDraft && !suggestedReply) {
                            notify("amber", "لا يوجد رد للنسخ");
                            return;
                          }
                          navigator.clipboard.writeText(replyDraft || suggestedReply).then(
                            () => notify("emerald", "تم نسخ الرد"),
                            () => notify("amber", "تعذر النسخ، انسخ يدويًا")
                          );
                        }}
                        disabled={!clean(replyDraft || suggestedReply)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        <MessageSquareText className="h-4 w-4" />
                        {t("aiSupport.inbox.socialWorkspace.copySuggestedReply")}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <aside className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.12)] min-[1280px]:max-h-[calc(100vh-220px)] min-[1280px]:overflow-y-auto">
                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.automationStatus")}</div>
                      <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.automationSummary")}</div>
                    </div>
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-black ${automationToneClass(activeAutomationState.tone)}`}>
                      {activeAutomationState.enabled ? t("aiSupport.inbox.socialWorkspace.enabled") : t(activeAutomationState.labelKey)}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-sm text-slate-200">
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.configId")} value={activeAutomationState.configId || dash} icon={<Bot className="h-4 w-4 text-cyan-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.enabled")} value={activeAutomationState.enabled ? t("aiSupport.inbox.socialWorkspace.yes") : t("aiSupport.inbox.socialWorkspace.no")} icon={<Sparkles className="h-4 w-4 text-emerald-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.templateKey")} value={clean(activeAutomationConfig?.template_key || activeAutomationDraft?.templateId || "") || dash} icon={<MessageSquareText className="h-4 w-4 text-violet-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.productLinked")} value={activeProductCard.productCount > 0 ? t("aiSupport.inbox.socialWorkspace.yes") : t("aiSupport.inbox.socialWorkspace.no")} icon={<ShoppingBag className="h-4 w-4 text-amber-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.runtimeStatus")} value={clean(activeAutomationRuntime?.status || activeAutomationRuntimeMonitor?.status || "") || dash} icon={<ThumbsUp className="h-4 w-4 text-sky-100" />} />
                    <SidebarRow
                      label={t("aiSupport.inbox.socialWorkspace.lastReason")}
                      value={clean(activeAutomationRuntime?.skipped_reason || activeAutomationRuntime?.duplicate_reason || activeAutomationRuntime?.error_message || activeAutomationRuntimeMonitor?.skipped_reason || "") || dash}
                      icon={<AlertTriangle className="h-4 w-4 text-rose-100" />}
                    />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.detectedIntent")} value={clean(activeAutomationRuntimeMonitor?.detected_intent || activeAutomationAiSales?.intent || "") || dash} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.approvalState")} value={clean(activeAutomationRuntimeMonitor?.approval_status || activeAutomationAiSales?.approval_status || "") || dash} icon={<Bot className="h-4 w-4 text-fuchsia-100" />} />
                  </div>
                  <div className="mt-2 grid gap-2">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.generatedPublicReply")}</div>
                      <div className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-200">
                        {clean(activeAutomationRuntimeMonitor?.generated_public_reply || activeAutomationAiSales?.public_reply || "") || dash}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.generatedPrivateReply")}</div>
                      <div className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-200">
                        {clean(activeAutomationRuntimeMonitor?.generated_private_reply || activeAutomationAiSales?.private_reply || "") || dash}
                      </div>
                    </div>
                  </div>
                  {Array.isArray(activeAutomationRuntime?.step_results) && activeAutomationRuntime.step_results.length ? (
                      <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.035] p-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.lastSteps")}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {activeAutomationRuntime.step_results.slice(0, 6).map((step, index) => (
                          <span
                            key={`${step?.step || step?.name || "step"}:${index}`}
                            className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${automationToneClass(
                              normalizeAutomationRuntimeTone(step?.status || step?.result || step?.outcome || "")
                            )}`}
                          >
                            {clean(step?.step || step?.name || `step_${index + 1}`)}: {clean(step?.status || step?.result || step?.outcome || "") || dash}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.aiAssistant")}</div>
                      <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.insightDashboard")}</div>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black text-cyan-100">{t("aiSupport.inbox.socialWorkspace.live")}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-200">
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.mostAskedQuestion")} value={labelText(summaryBucketLabel(actionableComment))} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.suggestedReply")} value={suggestedReply || t("aiSupport.inbox.socialWorkspace.noSuggestion")} icon={<MessageSquareText className="h-4 w-4 text-emerald-100" />} />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.leadIntent")} value={t("aiSupport.inbox.socialWorkspace.leadIntentCounts", { leads: visibleComments.filter((item) => getCommentTags(item).includes("Lead")).length, price: visibleComments.filter((item) => getCommentTags(item).includes("Price")).length, size: visibleComments.filter((item) => getCommentTags(item).includes("Size")).length })} icon={<ThumbsUp className="h-4 w-4 text-violet-100" />} />
                    <SidebarRow
                      label={t("aiSupport.inbox.socialWorkspace.commentIdentity")}
                      value={selectFirst(resolveCommentCustomerName(actionableComment), activePostDetails?.customerName)}
                      icon={
                        resolveCommentCustomerAvatar(actionableComment) ? (
                          <img src={resolveCommentCustomerAvatar(actionableComment)} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <UserRound className="h-4 w-4 text-amber-100" />
                        )
                      }
                    />
                    <SidebarRow label={t("aiSupport.inbox.socialWorkspace.autoReplyStatus")} value={currentGlobalSettings.generic_enabled ? t("aiSupport.inbox.socialWorkspace.globalOn") : t("aiSupport.inbox.socialWorkspace.globalOff")} icon={<Bot className="h-4 w-4 text-sky-100" />} />
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.globalTemplate")}</div>
                      <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.genericReplyTemplate")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveGlobalSettings()}
                      disabled={savingGlobal}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      {savingGlobal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {t("aiSupport.inbox.socialWorkspace.saveGlobalTemplate")}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label={t("aiSupport.inbox.socialWorkspace.enabled")}
                      active={currentGlobalSettings.generic_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                    />
                    <TogglePill
                      label={t("aiSupport.inbox.socialWorkspace.likeState", { state: currentGlobalSettings.generic_like_enabled ? t("aiSupport.inbox.socialWorkspace.on") : t("aiSupport.inbox.socialWorkspace.off") })}
                      active={currentGlobalSettings.generic_like_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                    />
                    <TogglePill
                      label={t("aiSupport.inbox.socialWorkspace.replyState", { state: currentGlobalSettings.generic_reply_enabled ? t("aiSupport.inbox.socialWorkspace.on") : t("aiSupport.inbox.socialWorkspace.off") })}
                      active={currentGlobalSettings.generic_reply_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                    />
                  </div>

                  <select
                    value={currentGlobalSettings.mode || "manual_approval"}
                    onChange={(event) => setGlobalDraft((current) => ({ ...current, mode: event.target.value }))}
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="off">{t("aiSupport.inbox.ui.offLabel")}</option>
                    <option value="draft">{t("aiSupport.inbox.ui.draftOnly")}</option>
                    <option value="manual_approval">{t("aiSupport.inbox.ui.manualApproval")}</option>
                    <option value="full_auto">{t("aiSupport.inbox.ui.fullAuto")}</option>
                  </select>

                  <textarea
                    value={currentGlobalSettings.generic_template || ""}
                    onChange={(event) => setGlobalDraft((current) => ({ ...current, generic_template: event.target.value }))}
                    rows={4}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder={t("aiSupport.inbox.socialWorkspace.globalAutoReplyTemplate")}
                  />
                  <div className="mt-2 text-[11px] font-medium text-slate-400">{t("aiSupport.inbox.socialWorkspace.fullAutoWarning")}</div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.postTemplate")}</div>
                      <div className="mt-1 text-sm font-black text-white">{t("aiSupport.inbox.socialWorkspace.postTemplateHint")}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveTemplate()}
                      disabled={savingTemplate}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {t("aiSupport.inbox.socialWorkspace.savePostTemplate")}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label={activeTemplateEnabled ? t("aiSupport.inbox.socialWorkspace.enabled") : t("aiSupport.inbox.socialWorkspace.disabled")}
                      active={activeTemplateEnabled}
                      onClick={() =>
                        setTemplateDraft((current) => ({
                          ...(current || {}),
                          enabled: !activeTemplateEnabled,
                        }))
                      }
                    />
                    <TogglePill
                      label={t("aiSupport.inbox.socialWorkspace.likeState", { state: activeTemplate?.like_enabled !== false ? t("aiSupport.inbox.socialWorkspace.on") : t("aiSupport.inbox.socialWorkspace.off") })}
                      active={activeTemplate?.like_enabled !== false}
                      onClick={() =>
                        setTemplateDraft((current) => ({
                          ...(current || {}),
                          like_enabled: !(current?.like_enabled !== false),
                        }))
                      }
                    />
                    <TogglePill
                      label={t("aiSupport.inbox.socialWorkspace.replyState", { state: activeTemplate?.reply_enabled !== false ? t("aiSupport.inbox.socialWorkspace.on") : t("aiSupport.inbox.socialWorkspace.off") })}
                      active={activeTemplate?.reply_enabled !== false}
                      onClick={() =>
                        setTemplateDraft((current) => ({
                          ...(current || {}),
                          reply_enabled: !(current?.reply_enabled !== false),
                        }))
                      }
                    />
                  </div>

                  <select
                    value={activeTemplate?.mode || "manual_approval"}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...(current || {}),
                        mode: event.target.value,
                      }))
                    }
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="off">{t("aiSupport.inbox.ui.offLabel")}</option>
                    <option value="draft">{t("aiSupport.inbox.ui.draftOnly")}</option>
                    <option value="manual_approval">{t("aiSupport.inbox.ui.manualApproval")}</option>
                    <option value="full_auto">{t("aiSupport.inbox.ui.fullAuto")}</option>
                  </select>

                  <textarea
                    value={activeTemplate?.template || ""}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...(current || {}),
                        template: event.target.value,
                      }))
                    }
                    rows={5}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder={t("aiSupport.inbox.ui.templateHint")}
                  />

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.preview")}</div>
                      <button
                        type="button"
                        onClick={() => void handlePreviewReply()}
                        disabled={previewLoading || !actionableComment}
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                      >
                        {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {t("aiSupport.inbox.socialWorkspace.previewReply")}
                      </button>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{suggestedReply || t("aiSupport.inbox.socialWorkspace.noTemplateText")}</div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{t("aiSupport.inbox.socialWorkspace.quickActions")}</div>
                  <div className="mt-3 grid gap-2">
                    <QuickActionButton label={t("aiSupport.inbox.socialWorkspace.replyAllPriceQuestions")} onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Price")), replyDraft || previewReply || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Price")) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)} />
                    <QuickActionButton label={t("aiSupport.inbox.socialWorkspace.replyAllSizeQuestions")} onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Size")), replyDraft || previewReply || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Size")) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)} />
                    <QuickActionButton label={t("aiSupport.inbox.socialWorkspace.createLeads")} onClick={() => void handleCreateLead(firstMatchingComment((comment) => getCommentTags(comment).includes("Lead")))} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Lead"))} />
                    <QuickActionButton label={t("aiSupport.inbox.socialWorkspace.sendProduct")} onClick={() => void handleSendProduct()} />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>
      <SocialAutomationDrawer
        open={Boolean(automationDrawerPostKey)}
        post={automationDrawerPost || activePostDetails || activePost}
        draft={activeAutomationDraft}
        loading={automationLoadingKey === clean(automationDrawerPostKey)}
        saving={automationSavingKey === clean(automationDrawerPostKey)}
        loadError={automationLoadErrors[clean(automationDrawerPostKey)] || ""}
        runs={automationRuns}
        runsLoading={automationRunsLoading}
        runsError={automationRunsError}
        testing={automationTesting}
        testResult={automationTestResult}
        savedConfig={automationSavedConfigs[clean(automationDrawerPostKey)] || null}
        onClose={() => setAutomationDrawerPostKey("")}
        onSaveDraft={handleAutomationSaveLocal}
        onEnableAutomation={() => handleAutomationSaveLocal({ enabled: true })}
        onResetDraft={handleAutomationReset}
        onUpdateDraft={updateAutomationDraft}
        onSelectTemplate={handleAutomationSelectTemplate}
        onTestAutomation={handleAutomationTest}
      />
      <PostProductLinksDrawer
        open={Boolean(productLinksDrawerPostKey)}
        post={productLinksDrawerPost || activePostDetails || activePost}
        tenantId={resolvedTenantId}
        onClose={() => {
          setProductLinksDrawerPostKey("");
          setProductLinksDrawerPostSnapshot(null);
        }}
        onSaved={handleProductLinksSaved}
      />
    </section>
  );
}

function SidebarRow({ label, value, icon }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-2.5 ring-1 ring-white/[0.03]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-slate-200 ring-1 ring-white/10">{icon}</div>
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
          <div className="mt-1 text-sm font-semibold leading-6 text-slate-100">{value}</div>
        </div>
      </div>
    </div>
  );
}

function InfoChip({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-black text-white">{value || "—"}</div>
    </div>
  );
}

function TogglePill({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[11px] font-black transition ${
        active ? "bg-emerald-300 text-slate-950" : "border border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20"
      }`}
    >
      {label}
    </button>
  );
}

function QuickActionButton({ label, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-11 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-left text-xs font-black text-slate-200 transition hover:border-cyan-300/20 hover:bg-white/[0.06] disabled:opacity-40"
    >
      <span>{label}</span>
      <ArrowUpRight className="h-4 w-4" />
    </button>
  );
}

export default memo(SocialCommentsWorkspace);
