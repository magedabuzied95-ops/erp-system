import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Clock3,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldBan,
  Sparkles,
  ShoppingBag,
  ThumbsUp,
  UserRound,
} from "lucide-react";
import toast from "react-hot-toast";

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
const DEBUG_SOCIAL_PERF = false;

const toArray = (value) => (Array.isArray(value) ? value : []);

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
  if (!value) return "وقت غير معروف";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "وقت غير معروف";
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
};

const normalizeComment = (raw) => {
  const comment = raw || {};
  const metadata = comment.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : {};
  const customerName = clean(
    comment.customer_name ||
      comment.commenter_name ||
      comment.from?.name ||
      metadata.customer_name ||
      metadata.commenter_name ||
      metadata.from?.name ||
      "عميل"
  );
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
    raw: comment,
  };
};

const normalizePost = (raw) => {
  const post = raw || {};
  const metadata = post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const mappingSummary = post.mapping_summary && typeof post.mapping_summary === "object" && !Array.isArray(post.mapping_summary) ? post.mapping_summary : {};
  const attachmentImage = getAttachmentImage(post);
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
  const primaryLinkedProduct = post.primary_linked_product || post.primary_product || metadata.primary_linked_product || metadata.primary_product || mappingSummary.primary_linked_product || mappingSummary.primary_product || linkedProducts[0] || null;
  const mappedProductName = clean(primaryLinkedProduct?.name || primaryLinkedProduct?.title || primaryLinkedProduct?.product_name || "");
  const mappedProductPrice = clean(primaryLinkedProduct?.final_price || primaryLinkedProduct?.sale_price || primaryLinkedProduct?.price || primaryLinkedProduct?.selling_price || "");
  const mappedProductSizes = Array.isArray(primaryLinkedProduct?.available_sizes)
    ? primaryLinkedProduct.available_sizes.join(", ")
    : clean(primaryLinkedProduct?.sizes || "");
  const mappedProductColors = Array.isArray(primaryLinkedProduct?.available_colors)
    ? primaryLinkedProduct.available_colors.join(", ")
    : clean(primaryLinkedProduct?.colors || "");
  return {
    id: clean(post.canonical_post_id || post.platform_post_id || post.post_id || post.id || post.conversation_id || post.session_id || metadata.post_id || ""),
    postId: clean(post.canonical_post_id || post.platform_post_id || post.post_id || post.id || metadata.post_id || ""),
    platformPostId: clean(post.platform_post_id || metadata.platform_post_id || post.post_id || ""),
    canonicalPostId: clean(post.canonical_post_id || metadata.canonical_post_id || post.platform_post_id || post.post_id || ""),
    conversationId: clean(post.conversation_id || post.session_id || post.conversation_key || post.thread_id || metadata.conversation_id || ""),
    sessionId: clean(post.session_id || metadata.session_id || ""),
    platform: clean(post.platform || metadata.platform || "facebook").toLowerCase(),
    caption: clean(post.caption || post.post_caption || post.post_message || post.message || post.last_message || post.post_text || metadata.post_caption || metadata.post_message || metadata.caption || metadata.message || "منشور بدون نص"),
    thumbnailUrl:
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
      attachmentImage ||
      post.product_image_url ||
      post.product_image ||
      null,
    permalinkUrl: clean(post.permalink_url || post.post_permalink || post.post_permalink_url || post.post_url || metadata.permalink_url || metadata.post_permalink || metadata.post_permalink_url || metadata.post_url || ""),
    commentsCount: Number(post.comments_count || post.comment_count || post.total_comments || metadata.comments_count || 0),
    newCount: Number(post.new_comments_count || post.unread_comments_count || metadata.new_comments_count || 0),
    likesCount: parseOptionalCount(post.likes_count, post.like_count, post.reactions_count, post.total_likes, metadata.likes_count, metadata.like_count, metadata.reactions_count, metadata.total_likes),
    sharesCount: parseOptionalCount(post.shares_count, post.share_count, metadata.shares_count, metadata.share_count),
    publishedAt: clean(post.published_at || post.created_time || post.created_at || post.posted_at || metadata.published_at || metadata.created_time || metadata.created_at || metadata.posted_at || ""),
    lastActivity: clean(post.last_activity_at || post.last_comment_at || post.last_message_at || post.updated_at || post.created_at || metadata.last_activity_at || ""),
    autoReplyEnabled: Boolean(post.auto_reply_enabled || post.template_enabled || post.auto_reply_mode || metadata.auto_reply_enabled || metadata.template_enabled || metadata.auto_reply_mode),
    productName: clean(post.product_name || post.product_title || metadata.product_name || metadata.product_title || mappingSummary.primary_product_name || mappedProductName || ""),
    productId: clean(post.product_id || metadata.product_id || primaryLinkedProduct?.id || primaryLinkedProduct?.product_id || ""),
    product_id: clean(post.product_id || metadata.product_id || primaryLinkedProduct?.id || primaryLinkedProduct?.product_id || ""),
    productPrice: clean(post.product_price || metadata.product_price || mappedProductPrice || ""),
    productSalePrice: clean(post.product_sale_price || metadata.product_sale_price || clean(primaryLinkedProduct?.sale_price || "")),
    productSizes: clean(post.product_sizes || metadata.product_sizes || mappedProductSizes || ""),
    productColors: clean(post.product_colors || metadata.product_colors || mappedProductColors || ""),
    productStock: clean(post.product_stock || metadata.product_stock || primaryLinkedProduct?.stock || primaryLinkedProduct?.total_stock || ""),
    productVariantCount: clean(post.product_variant_count || metadata.product_variant_count || linkedProductsCount || ""),
    productLink: clean(post.product_link || post.product_storefront_url || post.product_url || metadata.product_link || metadata.product_storefront_url || metadata.product_url || primaryLinkedProduct?.product_url || ""),
    storeAddress: clean(post.store_address || metadata.store_address || ""),
    shippingTime: clean(post.shipping_time || metadata.shipping_time || ""),
    linkedProductsCount,
    linked_products_count: linkedProductsCount,
    linkedProducts,
    linked_products: linkedProducts,
    primaryLinkedProduct,
    primary_linked_product: primaryLinkedProduct,
    mapping_summary: mappingSummary,
    attachmentImage,
    raw: post,
  };
};

const postKey = (item = {}) => clean(item?.canonicalPostId || item?.platformPostId || item?.conversationId || item?.postId || item?.id || "");

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

const parseOptionalCount = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
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

const selectFirst = (...values) => values.map((value) => clean(value)).find(Boolean) || "";

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
  const label = key.includes("reel")
    ? "Reel"
    : key.includes("carousel")
      ? "Carousel"
      : key.includes("video")
        ? "Video"
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
  onSelectCustomer,
  tenantId = "",
  initialSelectedCommentId = "",
  nextCursor = "",
  onLoadMore,
  loadingMore = false,
}) {
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
  const [privateMessageLoadingKey, setPrivateMessageLoadingKey] = useState("");
  const [privateMessageStatusOverrides, setPrivateMessageStatusOverrides] = useState({});
  const [ignoreLoadingKey, setIgnoreLoadingKey] = useState("");
  const [leadLoadingKey, setLeadLoadingKey] = useState("");
  const [replyStatusOverrides, setReplyStatusOverrides] = useState({});
  const [expandedCaption, setExpandedCaption] = useState(false);
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
  const normalizedPosts = useMemo(
    () =>
      [...(Array.isArray(items) ? items.filter(Boolean) : [])]
        .map((post) => {
          const normalized = normalizePost(post);
          const override = productMappingOverrides[postKey(normalized)];
          return override ? normalizePost({ ...(normalized.raw || post || {}), ...override }) : normalized;
        })
        .sort((left, right) => new Date(right.lastActivity || 0).getTime() - new Date(left.lastActivity || 0).getTime()),
    [items, productMappingOverrides]
  );

  const selectedPostKey = clean(postKey(normalizePost(selectedPost || {})));
  const activePost = normalizedPosts.find((item) => postKey(item) === selectedPostKey) || normalizePost(selectedPost || normalizedPosts[0] || null);
  const activePostKey = clean(postKey(activePost));
  const activeThread = selectedThread || { post: null, comments: [], loading: false, error: "" };
  const comments = useMemo(() => (Array.isArray(activeThread.comments) ? activeThread.comments.filter(Boolean) : []), [activeThread.comments]);
  const normalizedComments = useMemo(() => comments.map((comment) => normalizeComment(comment)).filter(Boolean), [comments]);
  const activeThreadPostKey = clean(postKey(normalizePost(activeThread.post || {})));
  const activeThreadPost = normalizedPosts.find((item) => postKey(item) === activeThreadPostKey) || normalizePost(activeThread.post || null);
  const activePostDetails = normalizePost(activeThreadPost || activePost || null);
  const activeDisplayPost = activeThreadPost || activePostDetails || activePost || {};
  const activeDisplayLinkedProducts = getPostLinkedProducts(activeDisplayPost);

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
  const visibleComments = normalizedComments.filter((comment) => !ignoredCommentKeys.has(comment.id));
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
  const activePostImage = clean(
    activePostDetails?.thumbnailUrl ||
      activePostDetails?.raw?.thumbnailUrl ||
      activePostDetails?.raw?.thumbnail_url ||
      activePostDetails?.raw?.postThumbnail ||
      activePostDetails?.raw?.post_thumbnail ||
      activePostDetails?.raw?.postFullPicture ||
      activePostDetails?.raw?.post_full_picture ||
      activePostDetails?.raw?.attachmentImage ||
      activePostDetails?.raw?.attachment_image ||
      activePostDetails?.raw?.fullPicture ||
      activePostDetails?.raw?.full_picture ||
      activePostDetails?.raw?.picture ||
      activePostDetails?.raw?.mediaUrl ||
      activePostDetails?.raw?.media_url ||
      activePostDetails?.raw?.imageUrl ||
      activePostDetails?.raw?.image_url ||
      activePostDetails?.raw?.image ||
      ""
  );
  const activePostCaption = clean(activePostDetails?.caption || "");
  const activePostLink = clean(activePostDetails?.permalinkUrl || "");
  const activePlatform = platformMeta(activePostDetails?.platform || activePost?.platform || "");
  const activePostType = postTypeMeta(activePostDetails);
  const activePostPlatform = clean(activePostDetails?.platform || activePost?.platform || "facebook").toLowerCase();
  const activePostPostId = clean(activePostDetails?.postId || activePostDetails?.id || activePostKey);
  const activePostConversationId = clean(activePostDetails?.conversationId || activePostDetails?.sessionId || activePostDetails?.id || activePostKey);
  const activeTemplateEnabled = Boolean(activeTemplate?.enabled);
  const activePostPublishedAt = clean(activePostDetails?.publishedAt || activePostDetails?.createdAt || activePostDetails?.lastActivity || "");
  const activePostLikes = activePostDetails?.likesCount;
  const activePostShares = activePostDetails?.sharesCount;
  const activePostMediaBadge = resolvePostMediaBadge(activePostDetails) || postTypeMeta(activePostDetails);
  const activeAutomationDraftKey = automationDrawerPostKey || activePostKey;
  const automationDrawerPost = useMemo(() => {
    const drawerKey = clean(automationDrawerPostKey);
    if (!drawerKey) return null;
    return normalizedPosts.find((item) => postKey(item) === drawerKey) || (drawerKey === activePostKey ? activePostDetails : null);
  }, [activePostDetails, activePostKey, automationDrawerPostKey, normalizedPosts]);
  const activeAutomationDraft =
    automationDrafts[activeAutomationDraftKey] ||
    buildAutomationDraft(automationDrawerPost || activePostDetails || activePost || {});
  const productLinksDrawerPost = useMemo(() => {
    const drawerKey = clean(productLinksDrawerPostKey);
    if (!drawerKey) return null;
    return (
      productLinksDrawerPostSnapshot ||
      normalizedPosts.find((item) => postKey(item) === drawerKey) ||
      (drawerKey === activePostKey ? activePostDetails : null)
    );
  }, [activePostDetails, activePostKey, normalizedPosts, productLinksDrawerPostKey, productLinksDrawerPostSnapshot]);

  useEffect(() => {
    if (!productLinksDrawerPostKey) return;
    console.info("DRAWER_OPEN_STATE", {
      open: Boolean(productLinksDrawerPostKey),
      drawerPostKey: clean(productLinksDrawerPostKey),
      hasSnapshot: Boolean(productLinksDrawerPostSnapshot),
      resolvedPostKey: clean(productLinksDrawerPost?.canonicalPostId || productLinksDrawerPost?.platformPostId || productLinksDrawerPost?.conversationId || productLinksDrawerPost?.postId || productLinksDrawerPost?.id || ""),
      activePostKey,
    });
  }, [activePostKey, productLinksDrawerPost, productLinksDrawerPostKey, productLinksDrawerPostSnapshot]);

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
    setAutomationRunsLoading(true);
    setAutomationRunsError("");
    try {
      const payload = await api.get(`/social-comments/automation/${encodeURIComponent(key)}/runs`, {
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
    setAutomationTesting(true);
    setAutomationTestResult(null);
    try {
      const payload = await api.post(`/social-comments/automation/${encodeURIComponent(drawerKey)}/test`, {
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
    async (drawerKey = "", postForAutomation = {}) => {
      const key = clean(drawerKey || automationDrawerPostKey || activePostKey);
      if (!key) return null;
      const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
      const payload = await api.get(`/social-comments/automation/${encodeURIComponent(key)}`, {
        params: { tenant_id: resolvedTenantId, platform: platformForAutomation },
      });
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
      setAutomationSavedConfigs((current) => ({
        ...current,
        [key]: savedConfig,
      }));
      return { normalized, savedConfig };
    },
    [activePostKey, activePostPlatform, automationDrawerPostKey, resolvedTenantId]
  );

  const handleAutomationSaveLocal = () => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const currentDraft = automationDrafts[drawerKey] || buildAutomationDraft(postForAutomation);
    setAutomationDrafts((current) => ({
      ...current,
      [drawerKey]: currentDraft,
    }));
    void handleAutomationSaveRemote();
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
    const drawerPostKey = clean(key || postKey(post || activePostDetails || activePost || {}));
    if (!drawerPostKey) return;
    console.info("LINK_PRODUCTS_CLICK", {
      drawerPostKey,
      clickedPostKey: clean(postKey(post || {})),
      activePostKey,
      activeItemId: clean(activePostDetails?.conversationId || activePostDetails?.postId || activePostDetails?.id || ""),
      selectedPostKey: clean(postKey(selectedPost || {})),
    });
    console.info("SELECTED_POST", {
      selectedPost: selectedPost
        ? {
            key: clean(postKey(selectedPost || {})),
            platform: clean(selectedPost?.platform || ""),
            postId: clean(selectedPost?.postId || selectedPost?.post_id || selectedPost?.conversationId || selectedPost?.conversation_id || selectedPost?.id || ""),
          }
        : null,
      activePost: activePostDetails
        ? {
            key: clean(postKey(activePostDetails || {})),
            platform: clean(activePostDetails?.platform || ""),
            postId: clean(activePostDetails?.postId || activePostDetails?.post_id || activePostDetails?.conversationId || activePostDetails?.conversation_id || activePostDetails?.id || ""),
          }
        : null,
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

  const handleAutomationSaveRemote = async () => {
    const drawerKey = clean(automationDrawerPostKey || activePostKey);
    if (!drawerKey) return;
    const postForAutomation = automationDrawerPost || activePostDetails || activePost || {};
    const platformForAutomation = clean(postForAutomation?.platform || activePostPlatform || "facebook") || "facebook";
    const draft = automationDrafts[drawerKey] || buildAutomationDraft(postForAutomation);
    const payload = serializeAutomationDraft(draft, postForAutomation);
    setAutomationSavingKey(drawerKey);
    try {
      const response = await api.put(`/social-comments/automation/${encodeURIComponent(drawerKey)}`, {
        tenant_id: resolvedTenantId,
        platform: platformForAutomation,
        ...payload,
      });
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

  useEffect(() => {
    setExpandedCaption(false);
  }, [activePostKey]);


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

  const handleProductLinksSaved = async (payload = {}) => {
    const postId = clean(payload?.post_id || payload?.postId || productLinksDrawerPostKey || activePostKey);
    const linkedProducts = Array.isArray(payload?.linked_products) ? payload.linked_products : [];
    const primaryProduct = payload?.primary_product || payload?.primary_linked_product || linkedProducts[0] || null;
    if (postId) {
      const nextOverride = {
        ...payload,
        linked_products: linkedProducts,
        linked_products_count: Number(payload?.count ?? payload?.linked_products_count ?? linkedProducts.length ?? 0) || 0,
        primary_product: primaryProduct,
        primary_linked_product: primaryProduct,
      };
      setProductMappingOverrides((current) => ({
        ...current,
        [postId]: nextOverride,
      }));
    }
    if (onRefresh) {
      void Promise.resolve(onRefresh());
    }
  };

  const handleOpenPost = () => {
    if (!activePostLink) {
      notify("amber", "لا يوجد رابط بوست لفتحه");
      return;
    }
    setOpeningPost(true);
    try {
      const opened = window.open(activePostLink, "_blank", "noopener,noreferrer");
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
      const confirmed = window.confirm("Full Auto يفعّل الرد الكامل تلقائيًا. هل تريد المتابعة؟");
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
      const confirmed = window.confirm("Full Auto يفعّل الرد الكامل تلقائيًا لهذا البوست. هل تريد المتابعة؟");
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
    console.warn("[social-comments:action-id-debug]", {
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
    console.warn("[social-comments:action-id-debug]", {
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
    console.warn("[social-comments:private-action-click-debug]", {
      ...debugData,
      resolved_id: actionId,
    });
    console.warn("[social-comments:action-id-debug]", {
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
      await api.post(`/ai-inbox/comments/${encodeURIComponent(actionId)}/private-message`, {
        message: finalMessage,
        platform: activePostPlatform || "facebook",
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

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF) return;
    console.log("[SocialCommentsWorkspace][rendered-rows]", {
      posts: useVirtualPosts ? 50 : normalizedPosts.length,
      comments: commentsToRender.length,
    });
  }, [commentsToRender.length, normalizedPosts.length, useVirtualPosts]);

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

  return (
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white text-slate-900 shadow-[0_16px_50px_rgba(15,23,42,0.08)]">
      <div className="grid h-full min-h-0 w-full min-w-0 gap-2.5 p-2.5 min-[1024px]:grid-cols-[312px_minmax(0,1fr)] min-[1280px]:grid-cols-[312px_minmax(0,1fr)_348px]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex items-center justify-between gap-2 border-b border-[#E2E8F0] px-2.5 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Social Comments</div>
              <div className="mt-1 text-sm font-black text-slate-900">Posts</div>
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={loading || refreshing}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-[11px] font-black text-slate-900 shadow-sm disabled:opacity-50"
            >
              {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
            {!normalizedPosts.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-[#E2E8F0] bg-white text-slate-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-black text-slate-900">لا توجد منشورات بعد</div>
                <div className="mt-1 text-xs text-slate-500">سيظهر هنا المنشور المرتبط بالتعليقات عندما يتوفر</div>
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
                    return (
                      <article
                        key={key}
                        role={onSelectPost ? "button" : undefined}
                        tabIndex={onSelectPost ? 0 : undefined}
                        onClick={onSelectPost ? () => onSelectPost(post.raw, key) : undefined}
                        onKeyDown={
                          onSelectPost
                            ? (event) => {
                                if (event.key === "Enter" || event.key === " ") onSelectPost(post.raw, key);
                              }
                            : undefined
                        }
                        className={`rounded-2xl border p-2.5 transition shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${
                          active ? "border-[#CBD5E1] bg-white ring-1 ring-slate-200" : "border-[#E2E8F0] bg-white hover:border-slate-300"
                        }`}
                        style={{ minHeight: "176px" }}
                      >
                        <div className="flex gap-3">
                          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-slate-50">
                            {thumb ? (
                              <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                            ) : (
                              <div className="grid h-full w-full place-items-center bg-slate-50 text-slate-400">
                                <div className="flex flex-col items-center gap-1">
                                  <ImageIcon className="h-4 w-4" />
                                  <span className="rounded-full border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[8px] font-black tracking-[0.08em] text-slate-500">
                                    لا توجد صورة
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="line-clamp-2 text-sm font-black leading-6 text-slate-900">{post.caption || "Post"}</div>
                              </div>
                              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                              <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{post.commentsCount} comments</span>
                              <span className={`rounded-full border px-2.5 py-1 ${post.newCount > 0 ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" : "border-[#E2E8F0] bg-white text-slate-600"}`}>{post.newCount} new</span>
                              {post.linkedProductsCount > 0 ? (
                                <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-700">
                                  ✓ {post.primaryLinkedProduct?.name || "Linked Product"}
                                  {post.linkedProductsCount > 1 ? ` +${post.linkedProductsCount - 1}` : ""}
                                </span>
                              ) : (
                                <span className="rounded-full border border-amber-300/20 bg-amber-50 px-2.5 py-1 text-amber-700">⚠ No Product Linked</span>
                              )}
                              {postTypeMeta(post) ? <span className={`rounded-full border px-2.5 py-1 ${postTypeMeta(post).className}`}>{postTypeMeta(post).label}</span> : null}
                              {post.needsReply ? <span className="rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-1 text-[#C2410C]">Needs reply</span> : null}
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenAutomationDrawer(post, key);
                                }}
                                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700"
                              >
                                Automation
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleOpenProductLinksDrawer(post, key);
                                }}
                                className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-cyan-700"
                              >
                                Link Products
                              </button>
                            </div>
                            <div className="mt-2 text-[11px] font-medium text-slate-400">
                              <span className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-slate-600">
                                <Clock3 className="h-3.5 w-3.5" />
                                {absoluteTime(post.lastActivity)}
                              </span>
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
                  return (
                    <article
                      key={key}
                      role={onSelectPost ? "button" : undefined}
                      tabIndex={onSelectPost ? 0 : undefined}
                      onClick={onSelectPost ? () => onSelectPost(post.raw, key) : undefined}
                      onKeyDown={
                        onSelectPost
                          ? (event) => {
                              if (event.key === "Enter" || event.key === " ") onSelectPost(post.raw, key);
                            }
                          : undefined
                      }
                      className={`rounded-2xl border p-2.5 transition shadow-[0_8px_24px_rgba(15,23,42,0.04)] ${
                        active ? "border-[#CBD5E1] bg-white ring-1 ring-slate-200" : "border-[#E2E8F0] bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-slate-50">
                          {thumb ? (
                            <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-slate-50 text-slate-400">
                              <div className="flex flex-col items-center gap-1">
                                <ImageIcon className="h-4 w-4" />
                                <span className="rounded-full border border-[#E2E8F0] bg-white px-1.5 py-0.5 text-[8px] font-black tracking-[0.08em] text-slate-500">
                                  لا توجد صورة
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="line-clamp-2 text-sm font-black leading-6 text-slate-900">{post.caption || "Post"}</div>
                            </div>
                            <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${meta.className}`}>{meta.label}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">
                            <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{post.commentsCount} comments</span>
                            <span className={`rounded-full border px-2.5 py-1 ${post.newCount > 0 ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]" : "border-[#E2E8F0] bg-white text-slate-600"}`}>{post.newCount} new</span>
                            {post.linkedProductsCount > 0 ? (
                              <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-emerald-700">
                                ✓ {post.primaryLinkedProduct?.name || "Linked Product"}
                                {post.linkedProductsCount > 1 ? ` +${post.linkedProductsCount - 1}` : ""}
                              </span>
                            ) : (
                              <span className="rounded-full border border-amber-300/20 bg-amber-50 px-2.5 py-1 text-amber-700">⚠ No Product Linked</span>
                            )}
                            {postTypeMeta(post) ? <span className={`rounded-full border px-2.5 py-1 ${postTypeMeta(post).className}`}>{postTypeMeta(post).label}</span> : null}
                            {post.needsReply ? <span className="rounded-full border border-[#FED7AA] bg-[#FFF7ED] px-2.5 py-1 text-[#C2410C]">Needs reply</span> : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenAutomationDrawer(post, key);
                              }}
                              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-700"
                            >
                              Automation
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenProductLinksDrawer(post, key);
                              }}
                              className="rounded-full border border-cyan-200 bg-cyan-50 px-2.5 py-1 text-cyan-700"
                            >
                              Link Products
                            </button>
                          </div>
                          <div className="mt-2 text-[11px] font-medium text-slate-400">
                            <span className="inline-flex items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-2.5 py-1 text-slate-600">
                              <Clock3 className="h-3.5 w-3.5" />
                              {absoluteTime(post.lastActivity)}
                            </span>
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
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-900 shadow-sm disabled:opacity-50"
                >
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Load more
                </button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-[#E2E8F0] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Post Workspace
                  </div>
                  <h2 className="mt-1 line-clamp-2 text-2xl font-black leading-8 text-slate-900 min-[1600px]:text-3xl">{activePostCaption || "اختر منشورًا من القائمة"}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePlatform.className}`}>{activePlatform.label}</span>
                    {activePostType ? <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePostType.className}`}>{activePostType.label}</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                      {activePost.commentsCount || 0} comments
                    </span>
                    {activePostPublishedAt ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                        <Clock3 className="h-3.5 w-3.5" />
                        {absoluteTime(activePostPublishedAt)}
                      </span>
                    ) : null}
                    {typeof activePostLikes === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">{activePostLikes} likes</span> : null}
                    {typeof activePostShares === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">{activePostShares} shares</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-[10px] font-black text-slate-600">
                      {activePost.newCount || 0} new
                    </span>
                    {activeDisplayLinkedProducts.linkedProductsCount > 0 ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                        ✓ Linked Products
                        {activeDisplayLinkedProducts.primaryProductName ? ` · ${activeDisplayLinkedProducts.primaryProductName}` : ""}
                        {activeDisplayLinkedProducts.linkedProductsCount > 1 ? ` +${activeDisplayLinkedProducts.linkedProductsCount - 1}` : ""}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-50 px-2.5 py-1 text-[10px] font-black text-amber-700">
                        ⚠ No Product Linked
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenAutomationDrawer(activePostDetails, activePostKey)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-900 shadow-sm"
                >
                  <Bot className="h-4 w-4" />
                  Automation
                </button>
                <button
                  type="button"
                  onClick={handleOpenPost}
                  disabled={!activePostLink || openingPost}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-xs font-black text-slate-900 shadow-sm disabled:opacity-50"
                >
                  {openingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Open Post
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-2.5 p-3 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,348px)]">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden">
                <div className="overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
                  <button
                    type="button"
                    onClick={handleOpenPost}
                    disabled={!activePostLink || openingPost}
                    className="group relative flex h-[340px] items-center justify-center overflow-hidden bg-slate-100 text-left outline-none min-[1600px]:h-[420px] disabled:cursor-default"
                  >
                    {activePostImage ? (
                      <img src={activePostImage} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-slate-100 text-slate-500">
                        <div className="flex flex-col items-center gap-2">
                          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.05] ring-1 ring-white/10">
                            <Sparkles className="h-6 w-6 text-cyan-100" />
                          </span>
                          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] font-black tracking-[0.12em] text-slate-200">
                            لا توجد صورة
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
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/20 bg-white/90 px-3 text-[11px] font-black text-slate-900 shadow-sm disabled:opacity-50"
                      >
                        {openingPost ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                        Open Post
                      </button>
                    </div>
                  </button>

                  <div className="space-y-4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Post Summary</div>
                        <div className="mt-2 text-sm leading-7 text-slate-700">
                          <p className={expandedCaption ? "whitespace-pre-wrap" : "line-clamp-2 whitespace-pre-wrap"}>
                            {activePostCaption || "لا يوجد وصف للمنشور"}
                          </p>
                          {activePostCaption && activePostCaption.length > 140 ? (
                            <button
                              type="button"
                              onClick={() => setExpandedCaption((current) => !current)}
                              className="mt-2 inline-flex items-center gap-2 rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-700"
                            >
                              {expandedCaption ? "Collapse" : "Expand"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {activeDisplayPost?.productName || activeDisplayPost?.productPrice || activeDisplayPost?.productSalePrice || activeDisplayPost?.productSizes || activeDisplayPost?.productColors ? (
                      <div className="rounded-[22px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">ERP Product Card</div>
                            <div className="mt-1 text-sm font-black text-slate-900">{selectFirst(activeDisplayPost?.productName, "Linked product")}</div>
                          </div>
                          {selectFirst(activeDisplayPost?.productLink) ? (
                            <a
                              href={selectFirst(activeDisplayPost?.productLink)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-xl border border-[#E2E8F0] bg-white px-3 text-[11px] font-black text-slate-900 shadow-sm"
                            >
                              Product link
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                          <InfoChip label="Price" value={selectFirst(activeDisplayPost?.productPrice, "—")} />
                          <InfoChip label="Sale" value={selectFirst(activeDisplayPost?.productSalePrice, "—")} />
                          <InfoChip label="Sizes" value={selectFirst(activeDisplayPost?.productSizes, "—")} />
                          <InfoChip label="Colors" value={selectFirst(activeDisplayPost?.productColors, "—")} />
                          <InfoChip label="Stock" value={selectFirst(activeDisplayPost?.productStock, "—")} />
                          <InfoChip label="Variants" value={selectFirst(activeDisplayPost?.productVariantCount, "—")} />
                        </div>
                      </div>
                    ) : null}

                  <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                      <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{activePost.commentsCount || 0} comments</span>
                      {typeof activePostLikes === "number" ? <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{activePostLikes} likes</span> : null}
                      {typeof activePostShares === "number" ? <span className="rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1">{activePostShares} shares</span> : null}
                      {activePostPublishedAt ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-2.5 py-1 text-slate-600">
                          <Clock3 className="h-3.5 w-3.5" />
                          {absoluteTime(activePostPublishedAt)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Comments Timeline</div>
                      <div className="mt-1 text-sm font-black text-white">{displayComments.length} comments</div>
                      <div className="mt-1 text-xs text-slate-500">Showing the latest social thread activity</div>
                    </div>
                    {hasMoreComments ? (
                      <button
                        type="button"
                        onClick={() => setCommentWindowSize((current) => Math.min(displayComments.length, current + 50))}
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200"
                      >
                        Load older comments
                        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px]">
                          +{Math.min(50, displayComments.length - commentsToRender.length)}
                        </span>
                      </button>
                    ) : null}
                    {activeThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : null}
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
                          <div className="mt-3 text-sm font-black text-white">لا توجد تعليقات للعرض الآن</div>
                          <div className="mt-1 text-xs text-slate-500">عندما تصل تعليقات جديدة ستظهر هنا مباشرة</div>
                        </div>
                      </div>
                    ) : null}

                    {commentsToRender.map((comment) => {
                      const key = comment.id;
                      const attachmentPreview = getCommentAttachmentImage(comment.raw || comment);
                      const busy = isBusy(key);
                      const privateMessageSupported = supportsPrivateMessage(comment, activePostPlatform);
                      const privateMessageStatus = clean(privateMessageStatusOverrides[key] || "");
                      const isHighlighted = highlightedCommentKey === key;

                      return (
                        <div
                          key={key || `${comment.createdTime || ""}:comment`}
                          ref={(node) => {
                            if (!key) return;
                            if (node) commentRefs.current.set(key, node);
                            else commentRefs.current.delete(key);
                          }}
                          className={`rounded-[22px] transition ${isHighlighted ? "ring-2 ring-cyan-300/70 ring-offset-2 ring-offset-slate-950" : ""}`}
                        >
                          <CommentTimelineCard
                            comment={comment}
                            selected={key === selectedCommentKey || isHighlighted}
                            onSelect={() => setSelectedCommentKey(key)}
                            onCustomerSelect={onSelectCustomer}
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
                                    Media
                                  </span>
                                </div>
                              </a>
                            ) : null}

                            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void submitReply(comment, replyDraft || previewReply || suggestedReply);
                                }}
                                disabled={busy || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 shadow-[0_6px_18px_rgba(34,211,238,0.18)] disabled:opacity-50"
                              >
                                {replyLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Reply
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void submitPrivateMessage(comment, replyDraft || previewReply || suggestedReply);
                                }}
                                disabled={busy || !privateMessageSupported || !clean(replyDraft || previewReply || suggestedReply) || Boolean(privateMessageLoadingKey)}
                                title={privateMessageSupported ? "" : "Private messages are only supported for Facebook and Instagram comments"}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                              >
                                {privateMessageLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                                {privateMessageStatus === "sent" ? "Sent" : "Private Message"}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleCreateLead(comment);
                                }}
                                disabled={busy}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                              >
                                {leadLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBag className="h-4 w-4" />}
                                Create Lead
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleIgnoreComment(comment);
                                }}
                                disabled={busy}
                                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-300 disabled:opacity-50"
                              >
                                {ignoreLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldBan className="h-4 w-4" />}
                                Ignore
                              </button>
                            </div>
                          </CommentTimelineCard>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rounded-[24px] border border-white/10 bg-slate-950/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Reply Composer</div>
                        <div className="mt-1 text-sm font-black text-white">Draft a reply for the selected comment</div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handlePreviewReply()}
                          disabled={previewLoading || !actionableComment}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                        >
                          {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Preview Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopySuggestedReply()}
                          disabled={!clean(suggestedReply)}
                          className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                          Copy suggested reply
                        </button>
                      </div>
                    </div>

                    <textarea
                      ref={composerRef}
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none"
                      placeholder="Reply draft"
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void submitReply(actionableComment, replyDraft || previewReply || suggestedReply)}
                        disabled={!actionableComment || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                      >
                        {replyLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Send suggested reply
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitPrivateMessage(actionableComment, replyDraft || previewReply || suggestedReply)}
                        disabled={!actionableComment || !supportsPrivateMessage(actionableComment, activePostPlatform) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(privateMessageLoadingKey)}
                        title={supportsPrivateMessage(actionableComment, activePostPlatform) ? "" : "Private messages are only supported for Facebook and Instagram comments"}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        {privateMessageLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                        {activePrivateMessageStatus === "sent" ? "Sent" : "Private Message"}
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
                        Copy suggested reply
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <aside className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">AI Assistant</div>
                      <div className="mt-1 text-sm font-black text-white">Insight dashboard</div>
                    </div>
                    <span className="inline-flex items-center rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-black text-cyan-100">Live</span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-200">
                    <SidebarRow label="Most Asked Question" value={labelText(summaryBucketLabel(actionableComment))} icon={<Sparkles className="h-4 w-4 text-cyan-100" />} />
                    <SidebarRow label="Suggested Reply" value={suggestedReply || "No suggestion yet."} icon={<MessageSquareText className="h-4 w-4 text-emerald-100" />} />
                    <SidebarRow label="Lead Intent" value={`${visibleComments.filter((item) => getCommentTags(item).includes("Lead")).length} leads / ${visibleComments.filter((item) => getCommentTags(item).includes("Price")).length} price / ${visibleComments.filter((item) => getCommentTags(item).includes("Size")).length} size`} icon={<ThumbsUp className="h-4 w-4 text-violet-100" />} />
                    <SidebarRow
                      label="Comment Identity"
                      value={selectFirst(resolveCommentCustomerName(actionableComment), activePostDetails?.customerName)}
                      icon={
                        resolveCommentCustomerAvatar(actionableComment) ? (
                          <img src={resolveCommentCustomerAvatar(actionableComment)} alt="" className="h-4 w-4 rounded-full object-cover" />
                        ) : (
                          <UserRound className="h-4 w-4 text-amber-100" />
                        )
                      }
                    />
                    <SidebarRow label="Auto Reply Status" value={currentGlobalSettings.generic_enabled ? "Global ON" : "Global OFF"} icon={<Bot className="h-4 w-4 text-sky-100" />} />
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Global Template</div>
                      <div className="mt-1 text-sm font-black text-white">Generic reply template</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveGlobalSettings()}
                      disabled={savingGlobal}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      {savingGlobal ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Save Global Template
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label="Enabled"
                      active={currentGlobalSettings.generic_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_enabled: !current.generic_enabled }))}
                    />
                    <TogglePill
                      label={`Like ${currentGlobalSettings.generic_like_enabled ? "ON" : "OFF"}`}
                      active={currentGlobalSettings.generic_like_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_like_enabled: !current.generic_like_enabled }))}
                    />
                    <TogglePill
                      label={`Reply ${currentGlobalSettings.generic_reply_enabled ? "ON" : "OFF"}`}
                      active={currentGlobalSettings.generic_reply_enabled}
                      onClick={() => setGlobalDraft((current) => ({ ...current, generic_reply_enabled: !current.generic_reply_enabled }))}
                    />
                  </div>

                  <select
                    value={currentGlobalSettings.mode || "manual_approval"}
                    onChange={(event) => setGlobalDraft((current) => ({ ...current, mode: event.target.value }))}
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 text-sm font-black text-white outline-none"
                  >
                    <option value="off">Off</option>
                    <option value="draft">Draft only</option>
                    <option value="manual_approval">Manual Approval</option>
                    <option value="full_auto">Full Auto</option>
                  </select>

                  <textarea
                    value={currentGlobalSettings.generic_template || ""}
                    onChange={(event) => setGlobalDraft((current) => ({ ...current, generic_template: event.target.value }))}
                    rows={4}
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/70 p-3 text-sm text-white outline-none"
                    placeholder="Global auto reply template"
                  />
                  <div className="mt-2 text-[11px] font-medium text-slate-400">OFF by default. Full Auto requires explicit admin enablement.</div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Post Template</div>
                      <div className="mt-1 text-sm font-black text-white">Template specific to this post</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSaveTemplate()}
                      disabled={savingTemplate}
                      className="inline-flex h-8 items-center gap-2 rounded-xl bg-cyan-300 px-3 text-[11px] font-black text-slate-950 disabled:opacity-50"
                    >
                      {savingTemplate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Save Post Template
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <TogglePill
                      label={activeTemplateEnabled ? "Enabled" : "Disabled"}
                      active={activeTemplateEnabled}
                      onClick={() =>
                        setTemplateDraft((current) => ({
                          ...(current || {}),
                          enabled: !activeTemplateEnabled,
                        }))
                      }
                    />
                    <TogglePill
                      label={`Like ${activeTemplate?.like_enabled !== false ? "ON" : "OFF"}`}
                      active={activeTemplate?.like_enabled !== false}
                      onClick={() =>
                        setTemplateDraft((current) => ({
                          ...(current || {}),
                          like_enabled: !(current?.like_enabled !== false),
                        }))
                      }
                    />
                    <TogglePill
                      label={`Reply ${activeTemplate?.reply_enabled !== false ? "ON" : "OFF"}`}
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
                    <option value="off">Off</option>
                    <option value="draft">Draft only</option>
                    <option value="manual_approval">Manual Approval</option>
                    <option value="full_auto">Full Auto</option>
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
                    placeholder="Template text using {customer_name}, {product_name}, {price}, {sale_price}, {sizes}, {colors}, {product_link}, {post_link}, {store_address}, {shipping_time}"
                  />

                  <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Preview</div>
                      <button
                        type="button"
                        onClick={() => void handlePreviewReply()}
                        disabled={previewLoading || !actionableComment}
                        className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[11px] font-black text-slate-200 disabled:opacity-50"
                      >
                        {previewLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        Preview Reply
                      </button>
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">{suggestedReply || "No template text yet."}</div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-slate-950/70 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Quick Actions</div>
                  <div className="mt-3 grid gap-2">
                    <QuickActionButton label="Reply All Price Questions" onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Price")), replyDraft || previewReply || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Price")) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)} />
                    <QuickActionButton label="Reply All Size Questions" onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Size")), replyDraft || previewReply || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Size")) || !clean(replyDraft || previewReply || suggestedReply) || Boolean(replyLoadingKey)} />
                    <QuickActionButton label="Create Leads" onClick={() => void handleCreateLead(firstMatchingComment((comment) => getCommentTags(comment).includes("Lead")))} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Lead"))} />
                    <QuickActionButton label="Send Product" onClick={() => void handleSendProduct()} />
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
