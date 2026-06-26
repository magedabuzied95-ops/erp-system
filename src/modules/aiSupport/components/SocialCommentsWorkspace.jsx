import { memo, useEffect, useMemo, useState } from "react";
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

const clean = (value = "") => String(value ?? "").trim();

const absoluteTime = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "—";
  return date.toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" });
};

const normalizeComment = (raw) => {
  const comment = raw || {};
  const metadata = comment.metadata && typeof comment.metadata === "object" && !Array.isArray(comment.metadata) ? comment.metadata : {};
  return {
    id: clean(comment.comment_id || comment.id || comment.external_message_id || comment.provider_message_id || metadata.comment_id || ""),
    message: clean(comment.customer_message || comment.message || comment.text || comment.message_text || comment.original_comment_text || metadata.customer_message || metadata.message || ""),
    customerName: clean(comment.commenter_name || comment.customer_name || metadata.commenter_name || metadata.customer_name || "عميل"),
    customerAvatar: clean(comment.avatar || comment.customer_avatar || comment.customer_avatar_url || comment.commenter_profile_picture_url || comment.avatar_url || comment.profile_pic || metadata.avatar || metadata.customer_avatar || ""),
    classification: clean(comment.classification_label || comment.classification || comment.intent || metadata.classification_label || metadata.classification || metadata.intent || "Question"),
    replyStatus: clean(comment.reply_status || metadata.reply_status || "pending"),
    createdTime: clean(comment.created_time || comment.created_at || comment.processed_at || metadata.created_time || metadata.created_at || metadata.processed_at || ""),
    metadata,
    postId: clean(comment.post_id || comment.conversation_post_id || comment.thread_post_id || metadata.post_id || ""),
    platform: clean(comment.platform || metadata.platform || ""),
    permalinkUrl: clean(comment.permalink_url || comment.comment_url || metadata.permalink_url || metadata.comment_url || ""),
    replyText: clean(comment.reply_text || comment.rendered_reply || metadata.reply_text || metadata.rendered_reply || ""),
    raw: comment,
  };
};

const normalizePost = (raw) => {
  const post = raw || {};
  const metadata = post.metadata && typeof post.metadata === "object" && !Array.isArray(post.metadata) ? post.metadata : {};
  const attachmentImage = getAttachmentImage(post);
  return {
    id: clean(post.post_id || post.id || post.conversation_id || post.session_id || metadata.post_id || ""),
    postId: clean(post.post_id || post.id || metadata.post_id || ""),
    conversationId: clean(post.conversation_id || post.session_id || post.conversation_key || post.thread_id || metadata.conversation_id || ""),
    sessionId: clean(post.session_id || metadata.session_id || ""),
    platform: clean(post.platform || metadata.platform || "facebook").toLowerCase(),
    caption: clean(post.caption || post.post_caption || post.post_message || post.message || post.last_message || post.post_text || metadata.post_caption || metadata.post_message || metadata.caption || metadata.message || "منشور بدون نص"),
    thumbnailUrl: post.thumbnail_url || post.post_thumbnail || post.post_full_picture || post.attachment_image || post.full_picture || metadata.thumbnail_url || metadata.post_thumbnail || metadata.post_full_picture || attachmentImage || post.picture || post.product_image_url || post.product_image || null,
    permalinkUrl: clean(post.permalink_url || post.post_permalink || post.post_permalink_url || post.post_url || metadata.permalink_url || metadata.post_permalink || metadata.post_permalink_url || metadata.post_url || ""),
    commentsCount: Number(post.comments_count || post.comment_count || post.total_comments || metadata.comments_count || 0),
    newCount: Number(post.new_comments_count || post.unread_comments_count || metadata.new_comments_count || 0),
    likesCount: parseOptionalCount(post.likes_count, post.like_count, post.reactions_count, post.total_likes, metadata.likes_count, metadata.like_count, metadata.reactions_count, metadata.total_likes),
    sharesCount: parseOptionalCount(post.shares_count, post.share_count, metadata.shares_count, metadata.share_count),
    publishedAt: clean(post.published_at || post.created_time || post.created_at || post.posted_at || metadata.published_at || metadata.created_time || metadata.created_at || metadata.posted_at || ""),
    lastActivity: clean(post.last_activity_at || post.last_comment_at || post.last_message_at || post.updated_at || post.created_at || metadata.last_activity_at || ""),
    autoReplyEnabled: Boolean(post.auto_reply_enabled || post.template_enabled || post.auto_reply_mode || metadata.auto_reply_enabled || metadata.template_enabled || metadata.auto_reply_mode),
    productName: clean(post.product_name || metadata.product_name || ""),
    productPrice: clean(post.product_price || metadata.product_price || ""),
    productSalePrice: clean(post.product_sale_price || metadata.product_sale_price || ""),
    productSizes: clean(post.product_sizes || metadata.product_sizes || ""),
    productColors: clean(post.product_colors || metadata.product_colors || ""),
    productStock: clean(post.product_stock || metadata.product_stock || ""),
    productVariantCount: clean(post.product_variant_count || metadata.product_variant_count || ""),
    productLink: clean(post.product_link || post.product_storefront_url || post.product_url || metadata.product_link || metadata.product_storefront_url || metadata.product_url || ""),
    storeAddress: clean(post.store_address || metadata.store_address || ""),
    shippingTime: clean(post.shipping_time || metadata.shipping_time || ""),
    attachmentImage,
    raw: post,
  };
};

const postKey = (item = {}) => clean(item?.conversationId || item?.postId || item?.id || "");

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
}) {
  const normalizedPosts = useMemo(
    () =>
      [...(Array.isArray(items) ? items.filter(Boolean) : [])]
        .map((post) => normalizePost(post))
        .sort((left, right) => new Date(right.lastActivity || 0).getTime() - new Date(left.lastActivity || 0).getTime()),
    [items]
  );

  const activePost = normalizePost(selectedPost || normalizedPosts[0] || null);
  const activePostKey = clean(postKey(activePost));
  const activeThread = selectedThread || { post: null, comments: [], loading: false, error: "" };
  const comments = useMemo(() => (Array.isArray(activeThread.comments) ? activeThread.comments.filter(Boolean) : []), [activeThread.comments]);
  const normalizedComments = useMemo(() => comments.map((comment) => normalizeComment(comment)).filter(Boolean), [comments]);
  const activePostDetails = normalizePost(activeThread.post || activePost || null);

  const [selectedCommentKey, setSelectedCommentKey] = useState("");
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
  const [ignoreLoadingKey, setIgnoreLoadingKey] = useState("");
  const [leadLoadingKey, setLeadLoadingKey] = useState("");
  const [globalDraft, setGlobalDraft] = useState(() => ({
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
    ...(globalSettings || {}),
  }));
  const [templateDraft, setTemplateDraft] = useState(() => selectedTemplate?.template || null);

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
    setIgnoredCommentKeys(new Set());
    setSelectedCommentKey("");
    setPreviewReply("");
    setReplyDraft("");
  }, [activePostKey]);

  const activeTemplate = templateDraft || selectedTemplate?.template || null;
  const currentGlobalSettings = globalDraft || globalSettings;
  const visibleComments = normalizedComments.filter((comment) => !ignoredCommentKeys.has(comment.id));
  const selectedVisibleComment =
    visibleComments.find((comment) => comment.id === clean(selectedCommentKey)) ||
    visibleComments[0] ||
    null;
  const actionableComment = selectedVisibleComment || null;

  useEffect(() => {
    if (!visibleComments.length) {
      setSelectedCommentKey("");
      return;
    }
      const nextSelected =
      visibleComments.find((comment) => comment.id === clean(selectedCommentKey)) ||
      visibleComments[0] ||
      null;
    const nextKey = clean(nextSelected?.id || "");
    if (nextKey && nextKey !== selectedCommentKey) {
      setSelectedCommentKey(nextKey);
    }
  }, [selectedCommentKey, visibleComments]);

  const activeSuggestedReply = useMemo(
    () =>
      templatePreviewText(activeTemplate || { template: currentGlobalSettings.generic_template || "" }, {
        customer_name: selectFirst(actionableComment?.customerName, "Customer"),
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
  const activePostImage = activePostDetails?.thumbnailUrl ? clean(activePostDetails.thumbnailUrl) : "";
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
    const commentId = clean(actionableComment?.id || "");
    if (!commentId) {
      notify("amber", "اختر تعليقًا أولًا");
      return;
    }
    setPreviewLoading(true);
    try {
      const payload = await api.post(`/social-comments/comments/${encodeURIComponent(commentId)}/auto-reply-preview`, {
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

  const submitReply = async (comment = actionableComment, replyText = replyDraft) => {
    const commentId = clean(comment?.id || "");
    const messageText = clean(replyText || suggestedReply);
    if (!commentId) {
      notify("amber", "اختر تعليقًا للرد");
      return;
    }
    if (!messageText) {
      notify("amber", "اكتب الرد أولًا");
      return;
    }
    setReplyLoadingKey(commentId);
    try {
      await api.post(`/ai-inbox/comments/${encodeURIComponent(commentId)}/reply`, {
        reply_text: messageText,
      });
      notify("emerald", "تم إرسال الرد");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      notify("rose", error?.message || "تعذر إرسال الرد");
    } finally {
      setReplyLoadingKey("");
    }
  };

  const submitPrivateMessage = async (comment = actionableComment, messageText = replyDraft || suggestedReply) => {
    const conversationId = clean(activePostConversationId || activePostPostId);
    const commentId = clean(comment?.id || "");
    const finalMessage = clean(messageText);
    if (!conversationId) {
      notify("amber", "تعذر تحديد المحادثة الخاصة لهذا البوست");
      return;
    }
    if (!finalMessage) {
      notify("amber", "اكتب رسالة خاصة أولًا");
      return;
    }
    setPrivateMessageLoadingKey(commentId || conversationId);
    try {
      await api.post(`/ai-inbox/inbox/${encodeURIComponent(conversationId)}/private-message`, {
        message: finalMessage,
        comment_id: commentId,
        platform: activePostPlatform || "facebook",
        post_id: activePostPostId,
      });
      notify("emerald", "تم إرسال الرسالة الخاصة");
      await Promise.resolve(onRefresh?.());
    } catch (error) {
      notify("rose", error?.message || "إرسال رسالة خاصة من التعليق يحتاج صلاحية/دعم Meta، استخدم فتح البوست مؤقتًا.");
    } finally {
      setPrivateMessageLoadingKey("");
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
    <section className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.045] text-white shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
      <div className="grid h-full min-h-0 w-full min-w-0 gap-2.5 p-2.5 min-[1024px]:grid-cols-[312px_minmax(0,1fr)] min-[1280px]:grid-cols-[312px_minmax(0,1fr)_348px]">
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/55 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-2.5 py-2.5">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Social Comments</div>
              <div className="mt-1 text-sm font-black text-white">Posts</div>
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={loading || refreshing}
              className="inline-flex h-8 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[11px] font-black text-slate-100 disabled:opacity-50"
            >
              {loading || refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
            {!normalizedPosts.length && !loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.02] p-6 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-black text-white">لا توجد منشورات بعد</div>
                <div className="mt-1 text-xs text-slate-500">سيظهر هنا المنشور المرتبط بالتعليقات عندما يتوفر</div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              {normalizedPosts.map((post) => {
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
                    className={`rounded-2xl border p-2.5 transition ${
                      active
                        ? "border-cyan-300/50 bg-gradient-to-br from-cyan-300/15 to-white/[0.06] ring-1 ring-cyan-300/20 shadow-[0_10px_24px_rgba(34,211,238,0.12)]"
                        : "border-white/10 bg-white/[0.04] hover:border-white/20 hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="flex gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-400">
                            <div className="flex flex-col items-center gap-1">
                              <ImageIcon className="h-4 w-4" />
                              <span className="rounded-full border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[8px] font-black tracking-[0.08em] text-slate-300">
                                لا توجد صورة
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
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{post.commentsCount} comments</span>
                          <span className={`rounded-full border px-2.5 py-1 ${post.newCount > 0 ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-slate-200"}`}>{post.newCount} new</span>
                          {postTypeMeta(post) ? <span className={`rounded-full border px-2.5 py-1 ${postTypeMeta(post).className}`}>{postTypeMeta(post).label}</span> : null}
                          {post.needsReply ? <span className="rounded-full border border-amber-300/20 bg-amber-400/10 px-2.5 py-1 text-amber-100">Needs reply</span> : null}
                        </div>
                        <div className="mt-2 text-[11px] font-medium text-slate-400">
                          <span className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {absoluteTime(post.lastActivity)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/50 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-white/10 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Post Workspace
                  </div>
                  <h2 className="mt-1 line-clamp-2 text-xl font-black leading-8 text-white min-[1600px]:text-2xl">{activePostCaption || "اختر منشورًا من القائمة"}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePlatform.className}`}>{activePlatform.label}</span>
                    {activePostType ? <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePostType.className}`}>{activePostType.label}</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-slate-200">
                      {activePost.commentsCount || 0} comments
                    </span>
                    {activePostPublishedAt ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-slate-200">
                        <Clock3 className="h-3.5 w-3.5" />
                        {absoluteTime(activePostPublishedAt)}
                      </span>
                    ) : null}
                    {typeof activePostLikes === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-slate-200">{activePostLikes} likes</span> : null}
                    {typeof activePostShares === "number" ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-slate-200">{activePostShares} shares</span> : null}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black text-slate-200">
                      {activePost.newCount || 0} new
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleOpenPost}
                  disabled={!activePostLink || openingPost}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-xs font-black text-cyan-100 disabled:opacity-50"
                >
                  {openingPost ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                  Open Post
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 gap-2.5 p-3 min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,348px)]">
              <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-hidden">
                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950/70 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
                  <button
                    type="button"
                    onClick={handleOpenPost}
                    disabled={!activePostLink || openingPost}
                    className="group relative flex h-[240px] items-center justify-center overflow-hidden bg-slate-900 text-left outline-none min-[1600px]:h-[300px] disabled:cursor-default"
                  >
                    {activePostImage ? (
                      <img src={activePostImage} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-cyan-400/10 via-slate-950 to-slate-900 text-slate-500">
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
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/88 via-slate-950/15 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 p-3.5">
                      <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-slate-950/75 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-100 shadow-[0_6px_18px_rgba(0,0,0,0.22)]">
                        {activePlatform.label}
                        {activePostType ? <span className={`rounded-full border px-2 py-0.5 ${activePostType.className}`}>{activePostType.label}</span> : null}
                      </div>
                      <div className="mt-2 line-clamp-2 max-w-3xl text-base font-black leading-7 text-white min-[1600px]:text-lg">{activePostCaption || "No caption available"}</div>
                    </div>
                  </button>

                  <div className="space-y-3 p-3.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Post Summary</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-7 text-slate-200">{activePostCaption || "لا يوجد وصف للمنشور"}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black ${activePlatform.className}`}>{activePlatform.label}</span>
                    </div>

                    {activePostDetails?.productName || activePostDetails?.productPrice || activePostDetails?.productSalePrice || activePostDetails?.productSizes || activePostDetails?.productColors ? (
                      <div className="rounded-[22px] border border-white/10 bg-white/[0.04] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">ERP Product Card</div>
                            <div className="mt-1 text-sm font-black text-white">{selectFirst(activePostDetails?.productName, "Linked product")}</div>
                          </div>
                          {selectFirst(activePostDetails?.productLink) ? (
                            <a
                              href={selectFirst(activePostDetails?.productLink)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-3 text-[11px] font-black text-cyan-100"
                            >
                              Product link
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          <InfoChip label="Price" value={selectFirst(activePostDetails?.productPrice, "—")} />
                          <InfoChip label="Sale" value={selectFirst(activePostDetails?.productSalePrice, "—")} />
                          <InfoChip label="Sizes" value={selectFirst(activePostDetails?.productSizes, "—")} />
                          <InfoChip label="Colors" value={selectFirst(activePostDetails?.productColors, "—")} />
                          <InfoChip label="Stock" value={selectFirst(activePostDetails?.productStock, "—")} />
                          <InfoChip label="Variants" value={selectFirst(activePostDetails?.productVariantCount, "—")} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Comments Timeline</div>
                      <div className="mt-1 text-sm font-black text-white">{visibleComments.length} comments</div>
                    </div>
                    {activeThread.loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-300" /> : null}
                  </div>

                  {activeThread.error ? (
                    <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm font-bold leading-6 text-rose-100">{activeThread.error}</div>
                  ) : null}

                  <div className="flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {!visibleComments.length && !activeThread.loading ? (
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

                    {visibleComments.map((comment) => {
                      const key = comment.id;
                      const status = clean(getCommentClassification(comment));
                      const avatar = comment.customerAvatar;
                      const name = comment.customerName;
                      const attachmentPreview = getCommentAttachmentImage(comment.raw || comment);
                      const text = getCommentText(comment) || "بدون نص";
                      const tags = getCommentTags(comment);
                      const busy = isBusy(key);
                      const selected = key === selectedCommentKey;

                      return (
                        <article
                          key={key || `${comment.createdTime || ""}:${name}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedCommentKey(key)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") setSelectedCommentKey(key);
                          }}
                          className={`rounded-[22px] border p-3 shadow-[0_8px_24px_rgba(0,0,0,0.12)] transition ${
                            selected ? "border-cyan-300/50 bg-gradient-to-br from-cyan-300/15 to-slate-950/55 ring-1 ring-cyan-300/15" : "border-white/10 bg-slate-950/65 hover:border-white/20 hover:bg-slate-950/75"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {avatar ? (
                              <img src={avatar} alt={name} className="h-11 w-11 shrink-0 rounded-full object-cover ring-1 ring-white/10" loading="lazy" />
                            ) : (
                              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/[0.04] text-slate-300 ring-1 ring-white/10">
                                <UserRound className="h-5 w-5" />
                              </span>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-black text-white">{name}</div>
                                  <div className="mt-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-300">
                                    <Clock3 className="h-3.5 w-3.5" />
                                    {absoluteTime(comment.createdTime)}
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  <span
                                    className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${
                                      status === "sent"
                                        ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                        : status === "failed"
                                          ? "border-rose-300/20 bg-rose-400/10 text-rose-100"
                                          : "border-white/10 bg-white/[0.04] text-slate-300"
                                    }`}
                                  >
                                    {labelText(status)}
                                  </span>
                                  {getCommentTags(comment).map((tag) => (
                                    <span key={tag} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-slate-200">
                                      {tag}
                                    </span>
                                  ))}
                                </div>
                              </div>

                              <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-100">{text}</div>

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
                                    void submitReply(comment, replyDraft || suggestedReply);
                                  }}
                                  disabled={busy || !clean(replyDraft || suggestedReply)}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-3 text-xs font-black text-slate-950 shadow-[0_6px_18px_rgba(34,211,238,0.18)] disabled:opacity-50"
                                >
                                  {replyLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                  Reply
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void submitPrivateMessage(comment, replyDraft || suggestedReply);
                                  }}
                                  disabled={busy || !clean(replyDraft || suggestedReply)}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-black text-slate-200 disabled:opacity-50"
                                >
                                  {privateMessageLoadingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                                  Private Message
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
                            </div>
                          </div>
                        </article>
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
                      value={replyDraft}
                      onChange={(event) => setReplyDraft(event.target.value)}
                      rows={4}
                      className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-white outline-none"
                      placeholder="Reply draft"
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void submitReply(actionableComment, previewReply || suggestedReply || replyDraft)}
                        disabled={!actionableComment || !clean(previewReply || suggestedReply || replyDraft) || Boolean(replyLoadingKey)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-black text-slate-950 disabled:opacity-50"
                      >
                        {replyLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Send suggested reply
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitPrivateMessage(actionableComment, previewReply || suggestedReply || replyDraft)}
                        disabled={!actionableComment || !clean(previewReply || suggestedReply || replyDraft) || Boolean(privateMessageLoadingKey)}
                        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-sm font-black text-slate-200 disabled:opacity-50"
                      >
                        {privateMessageLoadingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                        Private Message
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
                    <SidebarRow label="Customer Summary" value={selectFirst(actionableComment?.customerName, activePostDetails?.customerName, "Customer")} icon={<UserRound className="h-4 w-4 text-amber-100" />} />
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
                    <QuickActionButton label="Reply All Price Questions" onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Price")), replyDraft || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Price")) || !clean(replyDraft || suggestedReply)} />
                    <QuickActionButton label="Reply All Size Questions" onClick={() => void submitReply(firstMatchingComment((comment) => getCommentTags(comment).includes("Size")), replyDraft || suggestedReply)} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Size")) || !clean(replyDraft || suggestedReply)} />
                    <QuickActionButton label="Create Leads" onClick={() => void handleCreateLead(firstMatchingComment((comment) => getCommentTags(comment).includes("Lead")))} disabled={!firstMatchingComment((comment) => getCommentTags(comment).includes("Lead"))} />
                    <QuickActionButton label="Send Product" onClick={() => void handleSendProduct()} />
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </main>
      </div>
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


