import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import { subscribeRealtime } from "../../../shared/realtime/socketStore";
import Customer360Drawer from "../../aiSupport/components/Customer360Drawer.jsx";
import SocialCommentsWorkspace, { normalizeSocialPostDisplay } from "../../aiSupport/components/SocialCommentsWorkspace.jsx";

const clean = (value = "") => String(value ?? "").trim();
const ENABLE_SOCIAL_FAST_CENTER = true;
const DEBUG_SOCIAL_PERF = false;

const DEBUG_SOCIAL_COMMENTS =
  import.meta.env.DEV ||
  ["1", "true", "yes", "on"].includes(String(import.meta.env.VITE_AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || import.meta.env.VITE_AI_SUPPORT_DEBUG || "").toLowerCase());

const logDebug = (event, payload = {}) => {
  if (!DEBUG_SOCIAL_COMMENTS) return;
  console.info(event, payload);
};

const usePageVisible = () => {
  const [visible, setVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
};

const tenantIdFromAuth = () => {
  const tenant = getCurrentTenant?.() || {};
  const user = getCurrentUser?.() || {};
  return clean(user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "");
};

const socialPostIdentity = (item = {}) =>
  clean(
    item?.platform_post_id ||
      item?.source_post_id ||
      item?.sourcePostId ||
      item?.post_id ||
      item?.canonical_post_id ||
      item?.final_canonical_post_id ||
      item?.permalink_url ||
      item?.post_permalink_url ||
      item?.display_permalink ||
      item?.conversation_id ||
      item?.id ||
      item?.comment_id ||
      `${clean(item?.platform || "social")}:${clean(item?.post_id || item?.comment_id || "")}`
  );

const logSocialCardNormalizeRejectTrace = (raw = {}, rejectReason = "") => {
  const keys = raw && typeof raw === "object" ? Object.keys(raw) : [];
  const ids = [
    raw?.id,
    raw?.post_id,
    raw?.canonical_post_id,
    raw?.platform_post_id,
    raw?.source_post_id,
    raw?.permalink_url,
    raw?.post_permalink_url,
    raw?.post_link_key,
  ]
    .map((value) => clean(value))
    .filter(Boolean);
  console.warn("SOCIAL_CARD_NORMALIZE_REJECT_TRACE", {
    raw_keys: keys,
    raw_ids: ids,
    reject_reason: clean(rejectReason || "missing_identity"),
  });
};

const matchesValue = (left = "", right = "") => Boolean(clean(left)) && clean(left) === clean(right);

const normalizeFastSocialCommentItem = (item = {}) => {
  const postId = clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || "");
  const commentId = clean(item?.external_comment_id || item?.comment_id || item?.id || "");
  const messagePreview = clean(item?.message_preview || "");
  const activityAt = clean(item?.last_activity_at || item?.updated_at || item?.created_at || "");
  const status = clean(item?.status || "");
  const automationStatus = clean(item?.automation_status || "");
  const unread =
    item?.unread != null
      ? Boolean(item.unread)
      : !["sent", "delivered", "ignored", "processed", "closed", "resolved"].includes(status.toLowerCase()) &&
        !["sent", "delivered"].includes(automationStatus.toLowerCase());
  const resolvedIdentityId = clean(
    item?.id ||
    item?.post_id ||
    item?.canonical_post_id ||
    item?.platform_post_id ||
    item?.source_post_id ||
    item?.permalink_url ||
    item?.post_permalink_url ||
    item?.conversation_id ||
    commentId ||
    postId ||
    ""
  );
  if (!resolvedIdentityId) {
    logSocialCardNormalizeRejectTrace(item, "missing_identity");
  }

  return {
    ...item,
    id: resolvedIdentityId || clean(item?.id || commentId || postId || ""),
    post_id: postId,
    platform_post_id: clean(item?.platform_post_id || item?.post_id || postId || ""),
    source_post_id: clean(item?.source_post_id || item?.post_id || postId || ""),
    conversation_id: clean(item?.conversation_id || postId || ""),
    canonical_post_id: clean(item?.canonical_post_id || item?.final_canonical_post_id || postId || ""),
    final_canonical_post_id: clean(item?.final_canonical_post_id || item?.canonical_post_id || postId || ""),
    comment_id: commentId,
    external_comment_id: commentId,
    platform: clean(item?.platform || "facebook").toLowerCase(),
    customer_name: clean(item?.customer_name || "Customer"),
    customer_avatar_url: clean(item?.customer_avatar_url || ""),
    post_caption: clean(item?.post_caption || messagePreview),
    post_message: clean(item?.post_message || messagePreview),
    last_message: clean(item?.last_message || messagePreview),
    last_message_at: activityAt,
    last_activity_at: activityAt,
    last_comment_text: clean(item?.last_comment_text || messagePreview),
    last_comment_at: clean(item?.last_comment_at || activityAt),
    comments_count: Number(item?.comments_count || 1) || 1,
    new_comments_count: Number(item?.new_comments_count ?? (unread ? 1 : 0)) || 0,
    reply_status: clean(item?.reply_status || status || automationStatus || ""),
    auto_reply_mode: clean(item?.auto_reply_mode || automationStatus || ""),
    automation_status: automationStatus || status,
    session_status: clean(item?.session_status || item?.status || automationStatus || ""),
    status: status || automationStatus || "pending",
    unread,
    thumbnail_url: clean(item?.thumbnail_url || ""),
    post_thumbnail: clean(item?.post_thumbnail || ""),
    post_full_picture: clean(item?.post_full_picture || ""),
    post_permalink_url: clean(item?.post_permalink_url || item?.permalink_url || ""),
    permalink_url: clean(item?.permalink_url || item?.post_permalink_url || ""),
    post_link_key: clean(item?.post_link_key || item?.postLinkKey || resolvedIdentityId || postId || ""),
    product_id: clean(item?.product_id || ""),
    product_name: clean(item?.product_name || ""),
    auto_reply_enabled: Boolean(item?.auto_reply_enabled),
    template_enabled: Boolean(item?.template_enabled),
    generic_enabled: Boolean(item?.generic_enabled),
  };
};

const fastSocialCommentItemMatches = (left = {}, right = {}) => {
  const leftIds = [left?.id, left?.comment_id, left?.external_comment_id, left?.post_id].map((value) => clean(value)).filter(Boolean);
  const rightIds = [right?.id, right?.comment_id, right?.external_comment_id, right?.post_id].map((value) => clean(value)).filter(Boolean);
  if (!leftIds.length || !rightIds.length) return false;
  return leftIds.some((value) => rightIds.includes(value));
};

const mergeFastSocialCommentItem = (current = {}, patch = {}) =>
  normalizeFastSocialCommentItem({
    ...current,
    ...patch,
    comments_count: patch.comments_count ?? current.comments_count,
    new_comments_count: patch.new_comments_count ?? current.new_comments_count,
    unread: patch.unread ?? current.unread,
    last_comment_text: patch.last_comment_text || patch.message_preview || current.last_comment_text || current.post_caption || "",
    last_comment_at: patch.last_comment_at || patch.last_activity_at || current.last_comment_at || current.last_activity_at || "",
    last_activity_at: patch.last_activity_at || current.last_activity_at || "",
    thumbnail_url: patch.thumbnail_url || current.thumbnail_url || "",
    post_thumbnail: patch.post_thumbnail || current.post_thumbnail || "",
    post_full_picture: patch.post_full_picture || current.post_full_picture || "",
    customer_avatar_url: patch.customer_avatar_url || current.customer_avatar_url || "",
  });

const socialPostIdCandidates = (item = {}) => [
  item?.canonical_post_id,
  item?.canonicalPostId,
  item?.final_canonical_post_id,
  item?.finalCanonicalPostId,
  item?.platform_post_id,
  item?.platformPostId,
  item?.source_post_id,
  item?.sourcePostId,
  item?.post_id,
  item?.postId,
  item?.conversation_id,
  item?.conversationId,
  item?.id,
].map((value) => clean(value)).filter(Boolean);

const hydrateFastSocialCommentMedia = (current = {}, hydratedPosts = []) => {
  const currentIds = new Set(socialPostIdCandidates(current));
  const matched = hydratedPosts.find((post) => socialPostIdCandidates(post).some((id) => currentIds.has(id)));
  if (!matched) return current;
  const hydrated = normalizeSocialPostDisplay(matched);
  const displayImage = clean(hydrated?.displayImage || matched?.cover_image_url || matched?.thumbnail_url || matched?.post_thumbnail || "");
  const displayPermalink = clean(hydrated?.displayPermalink || matched?.permalink_url || matched?.post_permalink_url || "");
  return normalizeFastSocialCommentItem({
    ...current,
    thumbnail_url: displayImage || current.thumbnail_url,
    post_thumbnail: displayImage || current.post_thumbnail,
    post_full_picture: displayImage || current.post_full_picture,
    post_caption: clean(hydrated?.displayText || matched?.post_caption || matched?.caption || current.post_caption),
    post_message: clean(hydrated?.displayText || matched?.post_message || matched?.message || current.post_message),
    permalink_url: displayPermalink || current.permalink_url,
    post_permalink_url: displayPermalink || current.post_permalink_url,
    product_id: clean(matched?.product_id || hydrated?.primaryProduct?.id || current.product_id),
    product_name: clean(matched?.product_name || hydrated?.primaryProduct?.name || current.product_name),
  });
};

const findPostFromParams = (items = [], { postId = "", commentId = "", platform = "", pageId = "" } = {}) => {
  const normalizedPlatform = clean(platform).toLowerCase();
  const normalizedPageId = clean(pageId);
  const normalizedPostId = clean(postId);
  const normalizedCommentId = clean(commentId);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  if (normalizedPostId) {
    return (
      list.find((item) => clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || "") === normalizedPostId) ||
      null
    );
  }

  const matched = list.find((item) => {
    const itemPlatform = clean(item?.platform || item?.source_platform || "").toLowerCase();
    const itemPageId = clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || "");
    const itemPostId = clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || "");
    const itemCommentId = clean(item?.comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || "");

    if (normalizedPostId && matchesValue(itemPostId, normalizedPostId)) return true;
    if (normalizedCommentId && matchesValue(itemCommentId, normalizedCommentId)) return true;
    if (normalizedPageId && matchesValue(itemPageId, normalizedPageId)) return true;
    if (normalizedPlatform && itemPlatform && itemPlatform.includes(normalizedPlatform)) return true;
    return false;
  }) || null;

  if (matched) return matched;
  if (!normalizedPostId && !normalizedCommentId && !normalizedPageId && !normalizedPlatform) {
    return list[0] || null;
  }
  return null;
};

function SocialCommentsCenter() {
  buildPageTitle("Social Comments Center");

  const pageVisible = usePageVisible();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = clean(searchParams.get("tenant") || searchParams.get("tenantId") || tenantIdFromAuth());
  const postIdParam = clean(searchParams.get("postId") || searchParams.get("post_id") || "");
  const commentIdParam = clean(searchParams.get("commentId") || searchParams.get("comment_id") || "");
  const platformParam = clean(searchParams.get("platform") || "");
  const pageIdParam = clean(searchParams.get("pageId") || searchParams.get("page_id") || "");

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedPost, setSelectedPost] = useState(null);
  const [selectedThread, setSelectedThread] = useState({ post: null, comments: [], loading: false, error: "" });
  const [selectedTemplate, setSelectedTemplate] = useState({ template: null, loading: false, error: "" });
  const [globalSettings, setGlobalSettings] = useState({
    generic_enabled: false,
    generic_like_enabled: true,
    generic_reply_enabled: true,
    generic_template: "",
    mode: "manual_approval",
  });
  const [targetCommentMissing, setTargetCommentMissing] = useState(false);
  const [customerDrawer, setCustomerDrawer] = useState({ open: false, customer: null, customerId: "", context: {} });
  const [performanceSummary, setPerformanceSummary] = useState(null);
  const [performanceSummaryError, setPerformanceSummaryError] = useState("");
  const [performanceSummaryLoading, setPerformanceSummaryLoading] = useState(false);
  const [socketPatchCount, setSocketPatchCount] = useState(0);
  const [resolvedPostByUrl, setResolvedPostByUrl] = useState(null);
  const lastSelectionRef = useRef("");
  const requestedPostIdRef = useRef("");
  const renderedRowsWarnRef = useRef({ lastCount: 0, lastWarnAt: 0 });
  const isUrlLockedPost = Boolean(postIdParam);

  const openCustomerDrawer = useCallback((customer = {}, context = {}) => {
    const customerProfile = customer?.customer_profile || customer?.profile || {};
    const customerId = clean(
      customer.customer_profile_id ||
        customer.customerProfileId ||
        customer.external_customer_id ||
        customerProfile.id ||
        customer.id ||
        customer.commenter_id ||
        customer.profile_id ||
        ""
    );
    setCustomerDrawer({
      open: true,
      customer: {
        ...customer,
        id: customerId,
        customer_name:
          clean(customer.customer_name || customer.commenter_name || customer.author_name || customer.from_name || customerProfile.name || customerProfile.display_name || "") ||
          "Customer",
        customer_avatar_url: clean(customer.customer_avatar_url || customer.commenter_profile_picture_url || customerProfile.avatar_url || customerProfile.profile_pic_url || ""),
        platform: clean(customer.platform || context.platform || customerProfile.platform || ""),
        customer_profile: customerProfile,
        external_customer_id: clean(customer.external_customer_id || customerProfile.external_customer_id || ""),
      },
      customerId,
      context: {
        platform: clean(context.platform || customer.platform || ""),
        postId: clean(context.postId || customer.post_id || customer.postId || ""),
        commentId: clean(context.commentId || customer.comment_id || customer.commentId || ""),
        pageId: clean(context.pageId || customer.page_id || customer.pageId || ""),
        source: clean(context.source || customer.source || "social_comment"),
        lastActiveAt: clean(context.lastActiveAt || customer.created_at || customer.updated_at || ""),
        summary: clean(context.summary || customer.comment_text || customer.message || ""),
        customerName: clean(customer.customer_name || customer.commenter_name || customer.author_name || customer.from_name || ""),
    },
  });
  }, []);

const fastSocialCommentItemsEqual = (left = {}, right = {}) =>
  clean(left.id) === clean(right.id) &&
  clean(left.post_id) === clean(right.post_id) &&
  clean(left.external_comment_id) === clean(right.external_comment_id) &&
  clean(left.customer_name) === clean(right.customer_name) &&
  clean(left.customer_avatar_url) === clean(right.customer_avatar_url) &&
  clean(left.thumbnail_url) === clean(right.thumbnail_url) &&
  clean(left.post_thumbnail) === clean(right.post_thumbnail) &&
  clean(left.post_full_picture) === clean(right.post_full_picture) &&
  clean(left.message_preview) === clean(right.message_preview) &&
  clean(left.last_activity_at) === clean(right.last_activity_at) &&
  clean(left.status) === clean(right.status) &&
  clean(left.reply_status) === clean(right.reply_status) &&
  clean(left.auto_reply_mode) === clean(right.auto_reply_mode) &&
  clean(left.session_status) === clean(right.session_status) &&
  clean(left.replyStatus) === clean(right.replyStatus) &&
  clean(left.autoReplyMode) === clean(right.autoReplyMode) &&
  clean(left.sessionStatus) === clean(right.sessionStatus) &&
  clean(left.public_reply_status) === clean(right.public_reply_status) &&
  clean(left.dm_status) === clean(right.dm_status) &&
  clean(left.like_status) === clean(right.like_status) &&
  clean(left.automation_status) === clean(right.automation_status) &&
  clean(left.product_id) === clean(right.product_id) &&
  clean(left.product_name) === clean(right.product_name) &&
  Boolean(left.unread) === Boolean(right.unread);

  const selectedPostIdentity = useMemo(() => socialPostIdentity(selectedPost || {}), [selectedPost]);
  const routeSelection = useMemo(
    () => ({
      postId: postIdParam,
      commentId: commentIdParam,
      platform: platformParam,
      pageId: pageIdParam,
    }),
    [commentIdParam, pageIdParam, platformParam, postIdParam]
  );

  const loadPosts = useCallback(async ({ silent = false, cursor = "", append = false } = {}) => {
    if (!tenantId) return;
    if (!silent) setLoading(true);
    setError("");
    const perfLabel = "SocialCommentsCenter.fastList";
    if (DEBUG_SOCIAL_PERF) console.time(perfLabel);
    try {
      let payload = null;
      if (ENABLE_SOCIAL_FAST_CENTER) {
        try {
          payload = await api.get("/social-comments/fast-list", {
            params: { tenant_id: tenantId, limit: 20, cursor },
            perfComponent: "SocialCommentsCenter.fastList",
          });
        } catch (fastError) {
          console.warn("[SocialCommentsCenter][fast-list-fallback]", {
            tenant_id: tenantId,
            message: fastError?.message || "",
          });
        }
      }
      if (!payload) {
        payload = await api.get("/social-comments/posts", {
          params: { tenant_id: tenantId, limit: 50 },
          perfComponent: "SocialCommentsCenter.posts",
        });
      }
      const responseItems = Array.isArray(payload?.posts)
        ? payload.posts
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.data?.posts)
            ? payload.data.posts
            : Array.isArray(payload?.data?.items)
              ? payload.data.items
              : Array.isArray(payload)
                ? payload
                : [];
      const nextItems = ENABLE_SOCIAL_FAST_CENTER && Array.isArray(payload?.items) && !Array.isArray(payload?.data?.items)
        ? payload.items.map(normalizeFastSocialCommentItem)
        : responseItems;
      setItems((current) => (append ? [...current, ...nextItems] : nextItems));
      setNextCursor(clean(payload?.next_cursor || payload?.data?.next_cursor || ""));
      if (ENABLE_SOCIAL_FAST_CENTER && Array.isArray(payload?.items) && !cursor) {
        // Keep the list fast, then refresh short-lived Meta CDN URLs in the
        // background. This also restores post images whose old URLs expired.
        void api.get("/social-comments/posts", {
          params: { tenant_id: tenantId, limit: 50 },
          perfComponent: "SocialCommentsCenter.mediaHydration",
        }).then((mediaPayload) => {
          const hydratedPosts = Array.isArray(mediaPayload?.posts)
            ? mediaPayload.posts
            : Array.isArray(mediaPayload?.data?.posts)
              ? mediaPayload.data.posts
              : Array.isArray(mediaPayload)
                ? mediaPayload
                : [];
          if (!hydratedPosts.length) return;
          setItems((current) => current.map((item) => hydrateFastSocialCommentMedia(item, hydratedPosts)));
          setSelectedPost((current) => current ? hydrateFastSocialCommentMedia(current, hydratedPosts) : current);
          setResolvedPostByUrl((current) => current ? hydrateFastSocialCommentMedia(current, hydratedPosts) : current);
        }).catch((mediaError) => {
          logDebug("[SocialCommentsCenter][media-hydration-failed]", { message: mediaError?.message || "" });
        });
      }
    } catch (loadError) {
      setError(loadError?.message || "Failed to load social comments");
      if (!silent) {
        setItems([]);
      }
    } finally {
      if (DEBUG_SOCIAL_PERF) console.timeEnd(perfLabel);
      if (!silent) setLoading(false);
    }
  }, [tenantId]);

  const loadMorePosts = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPosts({ silent: true, cursor: nextCursor, append: true });
    } finally {
      setLoadingMore(false);
    }
  }, [loadPosts, loadingMore, nextCursor]);

  const loadGlobalSettings = useCallback(async () => {
    if (!tenantId) return;
    try {
      const payload = await api.get("/social-comments/auto-reply/settings", {
        params: { tenant_id: tenantId },
        perfComponent: "SocialCommentsCenter.globalSettings",
      });
      setGlobalSettings({
        generic_enabled: Boolean(payload?.settings?.generic_enabled),
        generic_like_enabled: payload?.settings?.generic_like_enabled !== false,
        generic_reply_enabled: payload?.settings?.generic_reply_enabled !== false,
        generic_template: clean(payload?.settings?.generic_template || ""),
        mode: clean(payload?.settings?.mode || "manual_approval") || "manual_approval",
      });
    } catch {
      setGlobalSettings((current) => current);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadPosts();
    void loadGlobalSettings();
  }, [loadGlobalSettings, loadPosts]);

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF || !tenantId || !pageVisible) return undefined;

    let cancelled = false;
    const loadPerformanceSummary = async () => {
      try {
        const payload = await api.get("/social-comments/performance/summary", {
          params: { tenant_id: tenantId },
          perfComponent: "SocialCommentsCenter.performanceSummary",
        });
        if (cancelled) return;
        setPerformanceSummary(payload || null);
        setPerformanceSummaryError("");
      } catch (error) {
        if (cancelled) return;
        setPerformanceSummaryError(error?.message || "Failed to load social comments performance summary");
      } finally {
        if (!cancelled) setPerformanceSummaryLoading(false);
      }
    };

    setPerformanceSummaryLoading(true);
    void loadPerformanceSummary();
    const intervalId = window.setInterval(() => {
      void loadPerformanceSummary();
    }, 30000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pageVisible, tenantId]);

  useEffect(() => {
    if (!DEBUG_SOCIAL_PERF) return;
    console.log("[SocialCommentsCenter][rendered-rows]", {
      count: items.length,
      next_cursor: Boolean(nextCursor),
    });
  }, [items.length, nextCursor]);

  useEffect(() => {
    if (items.length <= 100) {
      renderedRowsWarnRef.current.lastCount = items.length;
      return;
    }
    const now = Date.now();
    const previousCount = Number(renderedRowsWarnRef.current.lastCount || 0);
    const lastWarnAt = Number(renderedRowsWarnRef.current.lastWarnAt || 0);
    const crossedThreshold = previousCount <= 100;
    const throttled = now - lastWarnAt < 60_000;
    if (!crossedThreshold && throttled) {
      renderedRowsWarnRef.current.lastCount = items.length;
      return;
    }
    renderedRowsWarnRef.current.lastCount = items.length;
    renderedRowsWarnRef.current.lastWarnAt = now;
    console.warn("SOCIAL_UI_TOO_MANY_RENDERED_ROWS", {
      tenant_id: tenantId,
      rendered_rows: items.length,
      next_cursor: Boolean(nextCursor),
    });
  }, [items.length, nextCursor, tenantId]);

  useEffect(() => {
    if (!ENABLE_SOCIAL_FAST_CENTER) return undefined;
    const patchSocialComment = (payload = {}, { matchOnly = false } = {}) => {
      const normalizedPayload = normalizeFastSocialCommentItem(payload);
      if (!normalizedPayload.id && !normalizedPayload.external_comment_id && !normalizedPayload.post_id) return;

      setItems((current) => {
        const currentItems = Array.isArray(current) ? current : [];
        const matchIndex = currentItems.findIndex((item) => fastSocialCommentItemMatches(item, normalizedPayload));
        if (matchOnly && matchIndex < 0) return currentItems;

        const nextItem = matchIndex >= 0 ? mergeFastSocialCommentItem(currentItems[matchIndex], normalizedPayload) : normalizedPayload;
        if (matchIndex >= 0 && fastSocialCommentItemsEqual(currentItems[matchIndex], nextItem)) {
          return currentItems;
        }
        const nextItems = matchIndex >= 0
          ? [nextItem, ...currentItems.filter((_, index) => index !== matchIndex)]
          : [nextItem, ...currentItems];
        return nextItems.length === currentItems.length && nextItems.every((item, index) => item === currentItems[index]) ? currentItems : nextItems.slice(0, 100);
      });
    };

    const offNew = subscribeRealtime("social_comment:new", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) setSocketPatchCount((current) => current + 1);
      patchSocialComment(payload, { matchOnly: false });
    });
    const offUpdated = subscribeRealtime("social_comment:updated", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) setSocketPatchCount((current) => current + 1);
      patchSocialComment(payload, { matchOnly: true });
    });
    const offReplyStatus = subscribeRealtime("social_comment:reply_status", (payload = {}) => {
      if (DEBUG_SOCIAL_PERF) setSocketPatchCount((current) => current + 1);
      patchSocialComment(payload, { matchOnly: true });
    });
    return () => {
      offNew();
      offUpdated();
      offReplyStatus();
    };
  }, []);

  const selectedPostFromParams = useMemo(
    () => (isUrlLockedPost ? findPostFromParams(items, routeSelection) : null),
    [isUrlLockedPost, items, routeSelection]
  );
  const activePost = useMemo(() => {
    if (isUrlLockedPost) {
      return normalizeSocialPostDisplay(resolvedPostByUrl || selectedPost || selectedPostFromParams || null);
    }
    return selectedPost || selectedPostFromParams || null;
  }, [isUrlLockedPost, resolvedPostByUrl, selectedPost, selectedPostFromParams]);

  useEffect(() => {
    if (!selectedPostFromParams) return;
    if (selectedPostIdentity) return;
    if (selectedPostIdentity === socialPostIdentity(selectedPostFromParams)) return;
    if (isUrlLockedPost && resolvedPostByUrl) return;
    setSelectedPost(normalizeSocialPostDisplay(selectedPostFromParams));
  }, [isUrlLockedPost, resolvedPostByUrl, selectedPostFromParams, selectedPostIdentity]);

  useEffect(() => {
    if (!items.length) return;
    if (isUrlLockedPost) return;
    const nextPost = selectedPostFromParams || selectedPost || items[0] || null;
    if (!nextPost) return;
    const nextIdentity = socialPostIdentity(nextPost);
    if (!selectedPostIdentity) {
      setSelectedPost(normalizeSocialPostDisplay(nextPost));
    }
    if (!postIdParam && nextIdentity) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("postId", clean(nextPost?.post_id || nextPost?.conversation_id || nextPost?.id || nextIdentity));
      if (clean(nextPost?.platform || "") && !nextParams.get("platform")) nextParams.set("platform", clean(nextPost.platform));
      if (tenantId && !nextParams.get("tenant")) nextParams.set("tenant", tenantId);
      if (clean(nextPost?.page_id || nextPost?.metadata?.page_id || "") && !nextParams.get("pageId")) {
        nextParams.set("pageId", clean(nextPost?.page_id || nextPost?.metadata?.page_id || ""));
      }
      setSearchParams(nextParams, { replace: true });
    }
  }, [isUrlLockedPost, items, searchParams, selectedPost, selectedPostIdentity, selectedPostFromParams, setSearchParams, tenantId]);

  useEffect(() => {
    if (!isUrlLockedPost) {
      requestedPostIdRef.current = "";
      setResolvedPostByUrl(null);
      return;
    }

    const matchedPost = Array.isArray(items)
      ? items.find((item) => {
          const itemPostId = clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || "");
          return Boolean(itemPostId && itemPostId === postIdParam);
        }) || null
      : null;

    if (matchedPost) {
      const hydratedPost = normalizeSocialPostDisplay(matchedPost);
      const selected_post_id = clean(hydratedPost?.postId || hydratedPost?.post_id || hydratedPost?.conversationId || hydratedPost?.id || "");
      setResolvedPostByUrl(hydratedPost);
      requestedPostIdRef.current = "";
      console.info("SOCIAL_UI_SELECTED_POST_RESOLVED", {
        url_post_id: postIdParam,
        selected_post_id,
        active_post_id: selected_post_id,
        source: "list",
      });
      return;
    }

    if (requestedPostIdRef.current === postIdParam) return;
    requestedPostIdRef.current = postIdParam;

    let cancelled = false;
    void (async () => {
      try {
        const payload = await api.get(`/social-comments/posts/${encodeURIComponent(postIdParam)}/comments`, {
          params: { tenant_id: tenantId, platform: platformParam || undefined },
          perfComponent: "SocialCommentsCenter.postById",
        });
        if (cancelled) return;
        const postPayload = payload?.post || payload?.data?.post || payload?.data || null;
        const resolvedPost = postPayload ? normalizeSocialPostDisplay(postPayload) : null;
        const selected_post_id = clean(resolvedPost?.postId || resolvedPost?.post_id || resolvedPost?.conversationId || resolvedPost?.id || "");
        if (!resolvedPost || !selected_post_id) {
          console.info("SOCIAL_UI_SELECTED_POST_RESOLVED", {
            url_post_id: postIdParam,
            selected_post_id: "",
            active_post_id: "",
            source: "fallback",
          });
          return;
        }
        setResolvedPostByUrl(resolvedPost);
        setItems((current) => {
          const existing = Array.isArray(current)
            ? current.some((item) => clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || "") === selected_post_id)
            : false;
          return existing ? current : [resolvedPost, ...current];
        });
        console.info("SOCIAL_UI_SELECTED_POST_RESOLVED", {
          url_post_id: postIdParam,
          selected_post_id,
          active_post_id: selected_post_id,
          source: "fallback",
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("SOCIAL_UI_SELECTED_POST_RESOLVED", {
          url_post_id: postIdParam,
          selected_post_id: "",
          active_post_id: "",
          source: "fallback",
          message: error?.message || String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isUrlLockedPost, items, platformParam, postIdParam, tenantId]);

  const selectedPostDisplay = useMemo(() => normalizeSocialPostDisplay(activePost || selectedPostFromParams || selectedPost || {}), [activePost, selectedPost, selectedPostFromParams]);

  useEffect(() => {
    if (!activePost) return;
    console.info("SOCIAL_UI_POST_DISPLAY_FIELDS", {
      post_id: clean(activePost?.canonical_post_id || activePost?.final_canonical_post_id || activePost?.post_id || activePost?.conversation_id || activePost?.id || ""),
      displayText: Boolean(selectedPostDisplay.displayText),
      displayImage: Boolean(selectedPostDisplay.displayImage),
      displayPermalink: Boolean(selectedPostDisplay.displayPermalink),
      displayCreatedAt: Boolean(selectedPostDisplay.displayCreatedAt),
    });
  }, [activePost, selectedPostDisplay]);

  useEffect(() => {
    if (!activePost) return;
    const postId = clean(activePost?.canonical_post_id || activePost?.final_canonical_post_id || activePost?.post_id || activePost?.conversation_id || activePost?.id || "");
    if (!postId) return;

    let cancelled = false;
    const detailPerfLabel = "SocialCommentsCenter.detailLoad";
    const detailStartedAt = Date.now();
    if (DEBUG_SOCIAL_PERF) console.time(detailPerfLabel);
    setSelectedThread((current) => ({ ...current, loading: true, error: "" }));
    setSelectedTemplate((current) => ({ ...current, loading: true, error: "" }));
    setTargetCommentMissing(false);
    const platformValue = clean(activePost?.platform || platformParam || "facebook");

    void (async () => {
      try {
        const [threadPayload, templatePayload] = await Promise.all([
          api.get(`/social-comments/posts/${encodeURIComponent(postId)}/comments`, {
            params: { tenant_id: tenantId, platform: platformValue },
            perfComponent: "SocialCommentsCenter.thread",
          }),
          api.get(`/social-comments/posts/${encodeURIComponent(postId)}/template`, {
            params: { tenant_id: tenantId, platform: platformValue },
            perfComponent: "SocialCommentsCenter.template",
          }).catch(() => ({ template: null })),
        ]);
        if (cancelled) return;

        const comments = Array.isArray(threadPayload?.comments) ? threadPayload.comments : [];
        const matchedComment = commentIdParam ? comments.find((comment) => clean(comment?.comment_id || comment?.id || "") === commentIdParam) : null;
        const commentMissing = Boolean(commentIdParam) && !matchedComment;
        setTargetCommentMissing(commentMissing);
        setSelectedThread({
          post: threadPayload?.post || activePost,
          comments,
          loading: false,
          error: "",
        });
        setSelectedTemplate({
          template: templatePayload?.template || null,
          loading: false,
          error: "",
        });

        const selectionSignature = `${postId}:${commentIdParam || ""}:${platformValue}`;
        if (lastSelectionRef.current !== selectionSignature) {
          lastSelectionRef.current = selectionSignature;
          logDebug("SOCIAL_COMMENTS_AUTO_SELECT_POST", {
            post_id: postId,
            comment_id: commentIdParam,
            platform: platformValue,
            tenant: tenantId,
            page_id: clean(activePost?.page_id || activePost?.metadata?.page_id || pageIdParam || ""),
          });
          if (commentIdParam && matchedComment) {
            logDebug("SOCIAL_COMMENTS_AUTO_SELECT_COMMENT", {
              post_id: postId,
              comment_id: commentIdParam,
              platform: platformValue,
              tenant: tenantId,
              page_id: clean(activePost?.page_id || activePost?.metadata?.page_id || pageIdParam || ""),
            });
            logDebug("SOCIAL_COMMENTS_HIGHLIGHT_TARGET", {
              post_id: postId,
              comment_id: commentIdParam,
              platform: platformValue,
              tenant: tenantId,
              page_id: clean(activePost?.page_id || activePost?.metadata?.page_id || pageIdParam || ""),
            });
          }
        }
      } catch (loadError) {
        if (cancelled) return;
        setSelectedThread({
          post: activePost,
          comments: [],
          loading: false,
          error: loadError?.message || "تعذر تحميل تفاصيل البوست",
        });
        setSelectedTemplate({
          template: null,
          loading: false,
          error: loadError?.message || "تعذر تحميل القالب",
        });
      }
    })().finally(() => {
      if (DEBUG_SOCIAL_PERF) console.timeEnd(detailPerfLabel);
      const detailDurationMs = Date.now() - detailStartedAt;
      if (detailDurationMs > 300 && !cancelled) {
        console.warn("SOCIAL_UI_SLOW_DETAIL_LOAD", {
          tenant_id: tenantId,
          post_id: postId,
          platform: platformValue,
          duration_ms: detailDurationMs,
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activePost, commentIdParam, pageIdParam, platformParam, tenantId]);

  const handleRefresh = useCallback(() => {
    void loadPosts({ silent: true });
    void loadGlobalSettings();
  }, [loadGlobalSettings, loadPosts]);

  const handleSelectPost = useCallback((item = {}, itemKey = "") => {
    const nextPostId = clean(item?.canonical_post_id || item?.final_canonical_post_id || item?.post_id || item?.conversation_id || item?.id || itemKey);
    if (!nextPostId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("postId", nextPostId);
    nextParams.delete("commentId");
    nextParams.delete("comment_id");
    const nextPlatform = clean(item?.platform || platformParam || "");
    if (nextPlatform) nextParams.set("platform", nextPlatform);
    const nextPageId = clean(item?.page_id || item?.metadata?.page_id || "");
    if (nextPageId) nextParams.set("pageId", nextPageId);
    if (tenantId) nextParams.set("tenant", tenantId);
    setSearchParams(nextParams, { replace: false });
    setSelectedPost(normalizeSocialPostDisplay(item));
    setTargetCommentMissing(false);
  }, [platformParam, searchParams, setSearchParams, tenantId]);

  const missingCommentMessage = targetCommentMissing ? "Comment not found or already deleted." : "";

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] px-2 py-2 text-white md:px-3 md:py-3">
      <div className="mx-auto flex min-h-[calc(100dvh-1rem)] w-full max-w-[1800px] flex-col gap-2 overflow-hidden">
        <div className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-3 shadow-[0_18px_50px_rgba(0,0,0,0.22)] backdrop-blur">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">Marketing / Social Comments</div>
            <div className="mt-1 text-xl font-black text-white">Social Comments Center</div>
            <div className="mt-1 text-sm leading-6 text-slate-300">Open the post and the exact comment target from AI Inbox, with reply and moderation tools in one place.</div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-white/[0.07] px-3 text-xs font-black text-white shadow-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        {missingCommentMessage ? (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{missingCommentMessage}</span>
          </div>
        ) : null}

        {DEBUG_SOCIAL_PERF ? (
          <div className="rounded-3xl border border-primary/30 bg-primary-subtle px-4 py-4 text-primary shadow-[0_12px_30px_rgba(6,182,212,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Social Performance</div>
                <div className="mt-1 text-sm font-black text-primary">Admin debug summary</div>
              </div>
              <div className="text-[11px] font-black uppercase tracking-[0.12em] text-primary">
                {performanceSummaryLoading ? "Loading..." : "Live"}
              </div>
            </div>

            {performanceSummaryError ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                {performanceSummaryError}
              </div>
            ) : null}

            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Fast list avg ms</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.fast_list_avg_ms ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Fast list p95 ms</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.fast_list_p95_ms ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Cache hit rate</div>
                <div className="mt-1 text-lg font-black text-primary">{Math.round((Number(performanceSummary?.cache_hit_rate || 0) * 100))}%</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Slow fast-list</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.slow_fast_list_count ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Queue length</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.queue_length ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Active jobs</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.active_jobs ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Job avg ms</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.job_avg_ms ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Socket emits</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.socket_emit_count ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Rendered rows</div>
                <div className="mt-1 text-lg font-black text-primary">{items.length}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Socket patches</div>
                <div className="mt-1 text-lg font-black text-primary">{socketPatchCount}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Cache hits</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.fast_list_cache_hits ?? 0}</div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-primary bg-white px-3 py-2">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-primary">Cache misses</div>
                <div className="mt-1 text-lg font-black text-primary">{performanceSummary?.fast_list_cache_misses ?? 0}</div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && !items.length ? (
            <div className="flex h-full min-h-[420px] flex-col gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.055] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.18)]">
              <div className="h-5 w-40 rounded bg-slate-200/80" />
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="h-4 w-24 rounded bg-slate-200/80" />
                    <div className="mt-4 h-3 w-3/4 rounded bg-slate-200/70" />
                    <div className="mt-3 h-3 w-1/2 rounded bg-slate-200/70" />
                    <div className="mt-6 h-10 rounded-xl bg-slate-200/70" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <SocialCommentsWorkspace
              items={items}
              loading={loading}
              error={error}
              selectedPost={activePost || selectedPostFromParams || selectedPost || null}
              selectedThread={selectedThread}
              selectedTemplate={selectedTemplate}
              globalSettings={globalSettings}
              onRefresh={handleRefresh}
              onSelectPost={handleSelectPost}
              onSelectCustomer={openCustomerDrawer}
              tenantId={tenantId}
              initialSelectedCommentId={commentIdParam}
              nextCursor={nextCursor}
              onLoadMore={loadMorePosts}
              loadingMore={loadingMore}
            />
          )}
        </div>
      </div>
      <Customer360Drawer
        open={customerDrawer.open}
        onClose={() => setCustomerDrawer((current) => ({ ...current, open: false }))}
        customer={customerDrawer.customer}
        customerId={customerDrawer.customerId}
        context={customerDrawer.context}
        title="Customer 360"
      />
    </div>
  );
}

export default SocialCommentsCenter;
