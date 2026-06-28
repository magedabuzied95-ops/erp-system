import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { api } from "../../../shared/api/api";
import { getCurrentTenant, getCurrentUser } from "../../../shared/auth/authStorage";
import { buildPageTitle } from "../../../shared/hooks/usePageTitle";
import SocialCommentsWorkspace from "../../aiSupport/components/SocialCommentsWorkspace.jsx";

const clean = (value = "") => String(value ?? "").trim();

const DEBUG_SOCIAL_COMMENTS =
  import.meta.env.DEV ||
  ["1", "true", "yes", "on"].includes(String(import.meta.env.VITE_AI_SUPPORT_SOCIAL_COMMENTS_DEBUG || import.meta.env.VITE_AI_SUPPORT_DEBUG || "").toLowerCase());

const logDebug = (event, payload = {}) => {
  if (!DEBUG_SOCIAL_COMMENTS) return;
  console.info(event, payload);
};

const tenantIdFromAuth = () => {
  const tenant = getCurrentTenant?.() || {};
  const user = getCurrentUser?.() || {};
  return clean(user.tenant_id || user.tenantId || tenant.id || tenant.tenant_id || "");
};

const socialPostIdentity = (item = {}) =>
  clean(item?.post_id || item?.conversation_id || item?.id || item?.comment_id || `${clean(item?.platform || "social")}:${clean(item?.post_id || item?.comment_id || "")}`);

const matchesValue = (left = "", right = "") => Boolean(clean(left)) && clean(left) === clean(right);

const findPostFromParams = (items = [], { postId = "", commentId = "", platform = "", pageId = "" } = {}) => {
  const normalizedPlatform = clean(platform).toLowerCase();
  const normalizedPageId = clean(pageId);
  const normalizedPostId = clean(postId);
  const normalizedCommentId = clean(commentId);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];

  return (
    list.find((item) => {
      const itemPlatform = clean(item?.platform || item?.source_platform || "").toLowerCase();
      const itemPageId = clean(item?.page_id || item?.metadata?.page_id || item?.channel_metadata?.page_id || "");
      const itemPostId = clean(item?.post_id || item?.conversation_id || item?.id || "");
      const itemCommentId = clean(item?.comment_id || item?.metadata?.comment_id || item?.channel_metadata?.comment_id || "");

      if (normalizedPostId && matchesValue(itemPostId, normalizedPostId)) return true;
      if (normalizedCommentId && matchesValue(itemCommentId, normalizedCommentId)) return true;
      if (normalizedPageId && matchesValue(itemPageId, normalizedPageId)) return true;
      if (normalizedPlatform && itemPlatform && itemPlatform.includes(normalizedPlatform)) return true;
      return false;
    }) || list[0] || null
  );
};

function SocialCommentsCenter() {
  buildPageTitle("Social Comments Center");

  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = clean(searchParams.get("tenant") || searchParams.get("tenantId") || tenantIdFromAuth());
  const postIdParam = clean(searchParams.get("postId") || searchParams.get("post_id") || "");
  const commentIdParam = clean(searchParams.get("commentId") || searchParams.get("comment_id") || "");
  const platformParam = clean(searchParams.get("platform") || "");
  const pageIdParam = clean(searchParams.get("pageId") || searchParams.get("page_id") || "");

  const [items, setItems] = useState([]);
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
  const lastSelectionRef = useRef("");

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

  const loadPosts = useCallback(async ({ silent = false } = {}) => {
    if (!tenantId) return;
    if (!silent) setLoading(true);
    setError("");
    try {
      const payload = await api.get("/social-comments/posts", {
        params: { tenant_id: tenantId, limit: 50 },
        perfComponent: "SocialCommentsCenter.posts",
      });
      const nextItems = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.data?.items)
          ? payload.data.items
          : Array.isArray(payload)
            ? payload
            : [];
      setItems(nextItems);
    } catch (loadError) {
      setError(loadError?.message || "Failed to load social comments");
      setItems([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [tenantId]);

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

  const selectedPostFromParams = useMemo(
    () => findPostFromParams(items, routeSelection),
    [items, routeSelection]
  );
  const activePost = selectedPostFromParams || selectedPost || null;

  useEffect(() => {
    if (!selectedPostFromParams) return;
    if (selectedPostIdentity === socialPostIdentity(selectedPostFromParams)) return;
    setSelectedPost(selectedPostFromParams);
  }, [selectedPostFromParams, selectedPostIdentity]);

  useEffect(() => {
    if (!items.length) return;
    const nextPost = selectedPostFromParams || items[0] || null;
    if (!nextPost) return;
    const nextIdentity = socialPostIdentity(nextPost);
    if (!selectedPostIdentity) {
      setSelectedPost(nextPost);
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
  }, [items, postIdParam, searchParams, selectedPostIdentity, selectedPostFromParams, setSearchParams, tenantId]);

  useEffect(() => {
    if (!activePost) return;
    const postId = clean(activePost?.post_id || activePost?.conversation_id || activePost?.id || "");
    if (!postId) return;

    let cancelled = false;
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
    })();

    return () => {
      cancelled = true;
    };
  }, [activePost, commentIdParam, pageIdParam, platformParam, tenantId]);

  const handleRefresh = useCallback(() => {
    void loadPosts();
    void loadGlobalSettings();
  }, [loadGlobalSettings, loadPosts]);

  const handleSelectPost = useCallback((item = {}, itemKey = "") => {
    const nextPostId = clean(item?.post_id || item?.conversation_id || item?.id || itemKey);
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
    setSelectedPost(item);
    setTargetCommentMissing(false);
  }, [platformParam, searchParams, setSearchParams, tenantId]);

  const missingCommentMessage = targetCommentMissing ? "Comment not found or already deleted." : "";

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.14),transparent_28%),linear-gradient(180deg,#020617,#0f172a)] px-2 py-2 text-white md:px-3 md:py-3">
      <div className="mx-auto flex min-h-[calc(100dvh-1rem)] w-full max-w-[1800px] flex-col gap-2 overflow-hidden">
        <div className="flex items-start justify-between gap-3 rounded-3xl border border-white/10 bg-white/[0.045] p-3 shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100">Marketing / Social Comments</div>
            <div className="mt-1 text-xl font-black text-white">Social Comments Center</div>
            <div className="mt-1 text-sm leading-6 text-slate-300">Open the post and the exact comment target from AI Inbox, with reply and moderation tools in one place.</div>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-xs font-black text-slate-100 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-300/20 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">
            {error}
          </div>
        ) : null}

        {missingCommentMessage ? (
          <div className="flex items-center gap-2 rounded-2xl border border-amber-300/20 bg-amber-400/10 px-4 py-3 text-sm font-black text-amber-50">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{missingCommentMessage}</span>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          <SocialCommentsWorkspace
            items={items}
            loading={loading}
            error={error}
            selectedPost={selectedPostFromParams || selectedPost || null}
            selectedThread={selectedThread}
            selectedTemplate={selectedTemplate}
            globalSettings={globalSettings}
            onRefresh={handleRefresh}
            onSelectPost={handleSelectPost}
            tenantId={tenantId}
            initialSelectedCommentId={commentIdParam}
          />
        </div>
      </div>
    </div>
  );
}

export default SocialCommentsCenter;
