import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  Bot,
  Archive,
  Check,
  Clock,
  Copy,
  History,
  Grid2X2,
  Image,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import {
  archiveAutonomousAiMarketingQueueItem,
  approveAutonomousAiMarketingQueueItem,
  bulkAutonomousAiMarketingQueueAction,
  deleteAutonomousAiMarketingQueueItem,
  duplicateAutonomousAiMarketingQueueItem,
  generateAutonomousAiMarketingDaily,
  generateAutonomousAiMarketingMonthly,
  generateAutonomousAiMarketingQueueStoryAsset,
  generateAutonomousAiMarketingWeekly,
  getAutonomousAiMarketingOverview,
  getAutonomousAiMarketingQueue,
  getAutonomousAiMarketingSettings,
  getAutonomousAiMarketingQueueTimeline,
  pauseAutonomousAiMarketing,
  publishAutonomousAiMarketingQueueItemNow,
  resumeAutonomousAiMarketing,
  restoreAutonomousAiMarketingQueueItem,
  syncAutonomousAiMarketingInsights,
  updateAutonomousAiMarketingSettings,
} from "../services/marketingApi";
import { hasPermission } from "../../permissions/lib/rbacStore";
import AiMarketingCenterNav from "../components/AiMarketingCenterNav";
import PostEditorModal, { StoryCreativePreview, buildStoryCreativeSlides, getPreviewContentFlags, normalizeMarketingPostInput } from "../components/PostEditorModal";
import { canApproveQueueItem, canPublishQueueItem, getQueueStatusInfo, isPublishedQueueItem } from "../lib/queueStatus";
import {
  hasValidStoryAssetSnapshot,
  mergeStoryAssetResponse,
  normalizeStoryAssetSnapshot,
} from "../lib/storyAssetSnapshot";

const EMPTY_SETTINGS = {
  stories_per_day: 12,
  posts_per_day: 3,
  auto_publish: false,
  require_approval: true,
  auto_archive_published_after_days: 30,
  auto_delete_archived_after_days: 90,
  active_strategies: { new_arrivals: true, last_size: true, ai_posts: true },
  active: true,
  daily_content_quotas: [],
};

const QUEUE_FILTERS = [
  { value: "all", label: "All" },
  { value: "published", label: "منشور" },
  { value: "pending_approval", label: "بانتظار الموافقة" },
  { value: "ready", label: "جاهز" },
  { value: "queued", label: "في الطابور" },
  { value: "failed", label: "فشل" },
  { value: "archived", label: "مؤرشف" },
];

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/20 backdrop-blur-xl";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-black text-white outline-none focus:border-cyan-300/50";

const unwrapSettings = (payload) => payload?.settings || payload || EMPTY_SETTINGS;
const unwrapOverview = (payload) => payload?.overview || payload || {};
const isDev = () => typeof import.meta !== "undefined" && Boolean(import.meta.env?.DEV);
const logQueueDeleteDebug = (payload) => {
  if (!isDev() || typeof console === "undefined") return;
  console.debug("[ai-marketing-center] queue delete", payload);
};

const logInsightsSyncDebug = (payload) => {
  if (!isDev() || typeof console === "undefined") return;
  console.debug("[ai-insights-sync-response]", payload);
};

const logQueueAuditDebug = (label, payload) => {
  if (typeof console === "undefined" || typeof console.debug !== "function") return;
  console.debug(label, payload);
};

const formatApiError = (error, fallback) => {
  if (Number(error?.status) === 401) return "Session expired or unauthorized";
  if (Number(error?.status) === 403) return error?.message || "You do not have permission to use this AI Marketing Center action";
  return error?.message || fallback;
};

const isStaleQueueError = (error) => [404, 410].includes(Number(error?.status));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const uniqueMediaUrls = (item = {}) =>
  Array.from(
    new Set(
      [
        item.primary_image_url,
        item.variant_image_url,
        item.image_url,
        ...(Array.isArray(item.media_urls) ? item.media_urls : []),
        ...(Array.isArray(item.metadata?.generated_media_urls) ? item.metadata.generated_media_urls : []),
        ...(Array.isArray(item.design_json?.media_urls) ? item.design_json.media_urls : []),
        ...(Array.isArray(item.design_json?.generated_media_urls) ? item.design_json.generated_media_urls : []),
        ...(Array.isArray(item.design_json?.slides) ? item.design_json.slides.map((slide) => slide?.rendered_asset_url || slide?.final_asset_url || slide?.story_image_url) : []),
        ...(Array.isArray(item.design_json?.slides) ? item.design_json.slides.map((slide) => slide?.image_url) : []),
        ...(Array.isArray(item.design_json?.carousel) ? item.design_json.carousel.map((slide) => slide?.image_url) : []),
      ]
        .map((url) => String(url || "").trim())
        .filter(Boolean)
    )
  );

const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";

const queueStoryAssetUrl = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  return firstText(
    item.final_asset_url,
    item.selectedPublishUrl,
    item.rendered_image_url,
    item.story_image_url,
    design.final_asset_url,
    design.rendered_image_url,
    design.story_image_url,
    metadata.rendered_image_url,
    metadata.story_image_url,
    metadata.final_asset_url
  );
};

const isGeneratedStoryAssetUrl = (value = "") => {
  const url = String(value || "");
  return /(^|\/)uploads\/stories\//.test(url) || /\/(?:erp\/)?stories\//i.test(url);
};

const normalizeUrlList = (...values) =>
  Array.from(
    new Set(
      values
        .flatMap((value) => {
          if (Array.isArray(value)) return value;
          if (typeof value === "string" && value.trim().startsWith("[")) {
            try {
              const parsed = JSON.parse(value);
              return Array.isArray(parsed) ? parsed : [value];
            } catch {
              return [value];
            }
          }
          return [value];
        })
        .map((url) => String(url || "").trim())
        .filter(Boolean)
    )
  );

const slideGeneratedAssetUrls = (slides = []) =>
  Array.isArray(slides)
    ? slides.flatMap((slide) => [
        slide?.rendered_asset_url,
        slide?.final_asset_url,
        slide?.story_image_url,
        slide?.generated_asset_url,
        ...(Array.isArray(slide?.generated_asset_urls) ? slide.generated_asset_urls : []),
        ...(Array.isArray(slide?.generated_media_urls) ? slide.generated_media_urls : []),
        isGeneratedStoryAssetUrl(slide?.image_url) ? slide.image_url : "",
      ])
    : [];

const storyProductImageUrl = (item = {}) =>
  uniqueMediaUrls(item).find((url) => !isGeneratedStoryAssetUrl(url)) || "";

const generatedStoryAssetUrls = (item = {}) => {
  const snapshot = normalizeStoryAssetSnapshot(item);
  if (hasValidStoryAssetSnapshot(item)) return [snapshot.assetUrl];
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const explicitGeneratedUrls = normalizeUrlList(
    item.final_asset_urls,
    item.generated_asset_urls,
    item.generated_media_urls,
    design.final_asset_urls,
    design.generated_asset_urls,
    design.generated_media_urls,
    metadata.final_asset_urls,
    metadata.generated_asset_urls,
    metadata.generated_media_urls,
    slideGeneratedAssetUrls(design.slides),
    item.final_asset_url,
    item.rendered_image_url,
    item.story_image_url,
    design.final_asset_url,
    design.rendered_image_url,
    design.story_image_url,
    metadata.final_asset_url,
    metadata.rendered_image_url,
    metadata.story_image_url
  );
  const explicitSet = new Set(explicitGeneratedUrls);
  const sourceSet = new Set(sourceStoryImageUrls(item));
  const mediaUrls = normalizeUrlList(item.media_urls, design.media_urls, metadata.media_urls);
  const expectedGeneratedCount = Number(metadata.generated_asset_count || metadata.generated_slide_count || design.generated_asset_count || 0);
  const countedGeneratedMediaSet = new Set(expectedGeneratedCount > 0 ? mediaUrls.slice(0, expectedGeneratedCount) : []);
  const generatedMediaUrls = mediaUrls.filter((url) =>
    explicitSet.has(url) || countedGeneratedMediaSet.has(url) || (isGeneratedStoryAssetUrl(url) && !sourceSet.has(url))
  );
  return normalizeUrlList(explicitGeneratedUrls, generatedMediaUrls.filter((url) => countedGeneratedMediaSet.has(url) || !sourceSet.has(url)));
};

const sourceStoryImageUrls = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  return Array.from(new Set([
    ...(Array.isArray(metadata.source_image_urls) ? metadata.source_image_urls : []),
    ...(Array.isArray(design.source_media_urls) ? design.source_media_urls : []),
    ...(Array.isArray(design.slides) ? design.slides.map((slide) => slide?.source_product_image_url || slide?.original_image_url).filter(Boolean) : []),
    item.variant_image_url,
    design.variant_image_url,
    ...(Array.isArray(item.media_urls) ? item.media_urls : []),
    ...(Array.isArray(design.media_urls) ? design.media_urls : []),
    item.primary_image_url,
    item.image_url,
    design.primary_image_url,
    design.image_url,
  ].map((url) => String(url || "").trim()).filter((url) => url && !isGeneratedStoryAssetUrl(url))));
};

const storyDebugUrls = (item = {}) => {
  const design = item.design_json || {};
  const metadata = item.metadata || {};
  const finalAssetUrl = firstText(item.final_asset_url, design.final_asset_url, metadata.final_asset_url);
  const renderedImageUrl = firstText(item.rendered_image_url, design.rendered_image_url, metadata.rendered_image_url);
  const storyImageUrl = firstText(item.story_image_url, design.story_image_url, metadata.story_image_url);
  const finalAssetUrlRaw = firstText(item.final_asset_url_raw, item.final_asset_url, design.final_asset_url, metadata.final_asset_url);
  const selectedPublishUrlRaw = firstText(item.selectedPublishUrl_raw, finalAssetUrlRaw, renderedImageUrl, storyImageUrl);
  return {
    productImageUrl: storyProductImageUrl(item),
    rendered_image_url: renderedImageUrl,
    story_image_url: storyImageUrl,
    final_asset_url: finalAssetUrl,
    selectedPublishUrl: firstText(finalAssetUrl, renderedImageUrl, storyImageUrl),
    final_asset_url_raw: finalAssetUrlRaw,
    selectedPublishUrl_raw: selectedPublishUrlRaw,
  };
};

const queuePostUrl = (item = {}) => {
  const design = item.design_json || {};
  const results = item.platform_publish_results || {};
  const resultValues = Object.values(results).filter((value) => value && typeof value === "object");
  return firstText(
    item.post_url,
    item.permalink_url,
    item.published_url,
    item.public_url,
    item.url,
    design.post_url,
    design.permalink_url,
    design.published_url,
    ...resultValues.flatMap((result) => [
      result.post_url,
      result.permalink_url,
      result.permalink,
      result.published_url,
      result.public_url,
      result.url,
      result.link,
    ])
  );
};

const normalizeSizes = (value) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
};

const sizesLabelFrom = (...sources) => {
  for (const source of sources) {
    const label = String(source?.sizes_label || "").trim();
    if (label) return label.replace(/^sizes\s*:/i, "AVAILABLE SIZES:");
    const sizes = normalizeSizes(source?.available_sizes);
    if (sizes.length) return `AVAILABLE SIZES: ${sizes.join(", ")}`;
  }
  const fallback = sources.find((source) => source?.size_name || source?.size);
  const fallbackSize = String(fallback?.size_name || fallback?.size || "").trim();
  return fallbackSize ? `AVAILABLE SIZES: ${fallbackSize}` : "";
};

const startOfDay = (date = new Date()) => {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
};

const scheduleDate = (item = {}) => {
  const raw = item.scheduled_at || item.publish_at || item.scheduled_for || item.design_json?.scheduled_at || item.design_json?.best_posting_time || item.design_json?.posting_window;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const formatSchedule = (item = {}) => {
  const date = scheduleDate(item);
  if (!date) return "No schedule";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};

const scheduleGroupLabel = (item = {}) => {
  const date = scheduleDate(item);
  if (!date) return "Later";
  const today = startOfDay();
  const target = startOfDay(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays <= 6) return "This Week";
  if (diffDays <= 13) return "Next Week";
  return "Later";
};

const groupedBySchedule = (items = []) => {
  const order = ["Today", "Tomorrow", "This Week", "Next Week", "Later"];
  const groups = new Map(order.map((label) => [label, []]));
  items.forEach((item) => {
    const label = scheduleGroupLabel(item);
    groups.set(label, [...(groups.get(label) || []), item]);
  });
  return order.map((label) => ({ label, items: groups.get(label) || [] })).filter((group) => group.items.length);
};

const platformLabel = (item = {}) => {
  const design = item.design_json || {};
  const value = item.channel || design.channel || design.platform || design.platform_hint || (item.content_type === "story" ? "instagram/facebook" : "facebook/instagram");
  return String(value || "").replaceAll("_", " ");
};

const storyQueueCaption = (item = {}) => {
  const design = item.design_json || {};
  const productName = String(item.title || design.product_name || "").trim().toLowerCase();
  return String(item.caption || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      const lower = line.toLowerCase();
      if (productName && lower.startsWith(`${productName} - `)) return false;
      if (/^\s*(black|white|brown|blue|grey|gray|red|green|yellow|pink|purple|orange|beige|navy|sky|off white)\b/i.test(line)) return false;
      return true;
    })
    .join("\n");
};

function AiMarketingCenter() {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [overview, setOverview] = useState({});
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [preview, setPreview] = useState(null);
  const [publishingIds, setPublishingIds] = useState(() => new Set());
  const [generatingStoryAssetIds, setGeneratingStoryAssetIds] = useState(() => new Set());
  const [syncingInsights, setSyncingInsights] = useState(false);
  const [storyStatusFilter, setStoryStatusFilter] = useState("all");
  const [postStatusFilter, setPostStatusFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const loadInFlightRef = useRef(null);
  const storyAssetRequestsRef = useRef(new Map());
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const canCreateMarketing = hasPermission("marketing.create");

  const storiesAll = useMemo(() => queue.filter((item) => {
    const flags = getPreviewContentFlags(item);
    return flags.isStoryContent && !flags.isFeedContent;
  }), [queue]);
  const postsAll = useMemo(() => queue.filter((item) => {
    const flags = getPreviewContentFlags(item);
    return flags.isFeedContent;
  }), [queue]);
  const filterQueueItems = (items, statusFilter) => items.filter((item) => {
    const normalizedStatus = getQueueStatusInfo(item).normalizedStatus;
    if (statusFilter === "all") return normalizedStatus !== "archived";
    if (statusFilter === "queued") return ["queued", "generating_copy", "generating_image", "uploading"].includes(normalizedStatus);
    if (statusFilter === "ready") return ["ready", "approved", "scheduled", "generated"].includes(normalizedStatus);
    if (statusFilter === "failed") return ["failed", "publish_failed"].includes(normalizedStatus);
    return normalizedStatus === statusFilter;
  });
  const stories = useMemo(() => filterQueueItems(storiesAll, storyStatusFilter), [storiesAll, storyStatusFilter]);
  const posts = useMemo(() => filterQueueItems(postsAll, postStatusFilter), [postsAll, postStatusFilter]);
  const activeGenerationCount = useMemo(
    () => queue.filter((item) => ["queued", "generating_copy", "generating_image", "uploading"].includes(getQueueStatusInfo(item).normalizedStatus)).length,
    [queue]
  );

  const load = async ({ logQueueCount = false, silent = false } = {}) => {
    if (loadInFlightRef.current) return loadInFlightRef.current;
    const request = (async () => {
      try {
        if (!silent) setLoading(true);
        const [settingsResult, overviewResult, queueResult] = await Promise.allSettled([
          getAutonomousAiMarketingSettings(),
          getAutonomousAiMarketingOverview(),
          getAutonomousAiMarketingQueue({ include_archived: true }),
        ]);
        if (settingsResult.status === "fulfilled") {
          const nextSettings = unwrapSettings(settingsResult.value);
          setSettings({
            ...EMPTY_SETTINGS,
            ...nextSettings,
            active_strategies: {
              new_arrivals: nextSettings.active_strategies?.new_arrivals !== false,
              last_size: nextSettings.active_strategies?.last_size !== false,
              ai_posts: nextSettings.active_strategies?.ai_posts !== false,
            },
          });
        }
        if (overviewResult.status === "fulfilled") setOverview(unwrapOverview(overviewResult.value));

        let nextQueue = queueRef.current;
        if (queueResult.status === "fulfilled") {
          nextQueue = Array.isArray(queueResult.value) ? queueResult.value : [];
          setQueue((current) => {
            const previousIds = current.map((item) => item.id);
            const nextIds = nextQueue.map((item) => item.id);
            logQueueAuditDebug("[queue-status]", {
              source: "api-load",
              queueType: "all",
              count: nextQueue.length,
              previousIds,
              nextIds,
              staleRemainingIds: previousIds.filter((id) => !nextIds.some((nextId) => String(nextId) === String(id))),
              items: nextQueue.map((item) => getQueueStatusInfo(item, { source: "api-load", queueType: item.content_type || item.strategy_type || "queue" })),
            });
            return nextQueue;
          });
          if (logQueueCount) logQueueDeleteDebug({ queueReloadResultCount: nextQueue.length });
        }

        const failures = [settingsResult, overviewResult, queueResult].filter((result) => result.status === "rejected");
        if (failures.length && !silent) {
          toast.error(formatApiError(failures[0].reason, failures.length === 3 ? "تعذر تحميل مركز التسويق بالذكاء الاصطناعي" : "تم تحميل الصفحة جزئيًا، حاول التحديث مرة أخرى"));
        }
        return nextQueue;
      } catch (error) {
        if (!silent) toast.error(formatApiError(error, "تعذر تحميل مركز التسويق بالذكاء الاصطناعي"));
        return queueRef.current;
      } finally {
        if (!silent) setLoading(false);
      }
    })();
    loadInFlightRef.current = request;
    try {
      return await request;
    } finally {
      if (loadInFlightRef.current === request) loadInFlightRef.current = null;
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const hasActiveGeneration = queue.some((item) => ["queued", "generating_copy", "generating_image", "uploading"].includes(getQueueStatusInfo(item).normalizedStatus));
    if (!running && generatingStoryAssetIds.size === 0 && !hasActiveGeneration) return undefined;
    const timer = setInterval(() => {
      load({ silent: true });
    }, 2500);
    return () => clearInterval(timer);
  }, [queue, running, generatingStoryAssetIds]);

  const patchSettings = (patch) => setSettings((current) => ({ ...current, ...patch }));

  const toggleStrategy = (key, enabled) => {
    setSettings((current) => ({
      ...current,
      active_strategies: { ...current.active_strategies, [key]: enabled },
    }));
  };

  const saveSettings = async () => {
    try {
      setSaving(true);
      const payload = await updateAutonomousAiMarketingSettings({
        ...settings,
        planning_mode: "weekly",
        campaign_mode: "premium",
        active_strategies: {
          new_arrivals: settings.active_strategies?.new_arrivals !== false,
          last_size: settings.active_strategies?.last_size !== false,
          ai_posts: settings.active_strategies?.ai_posts !== false,
        },
        daily_content_quotas: [
          {
            id: "premium-engine",
            department_name: "All",
            segment_type: "all",
            segment_name: "All",
            stories_per_day: Number(settings.stories_per_day || 12),
            posts_per_day: Number(settings.posts_per_day || 3),
            priority: 100,
            active: true,
          },
        ],
      });
      setSettings({ ...EMPTY_SETTINGS, ...unwrapSettings(payload) });
      toast.success("Engine settings saved");
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Unable to save engine settings"));
    } finally {
      setSaving(false);
    }
  };

  const runGeneration = async (mode = "daily") => {
    try {
      setRunning(true);
      const result = mode === "monthly"
        ? await generateAutonomousAiMarketingMonthly()
        : mode === "weekly"
          ? await generateAutonomousAiMarketingWeekly()
          : await generateAutonomousAiMarketingDaily();
      toast.success(result?.queued ? "Generation queued" : `Generated ${result?.generated_stories || 0} stories and ${result?.generated_posts || 0} posts`);
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Generation failed"));
    } finally {
      setRunning(false);
    }
  };

  const updateQueueItem = async (target, action) => {
    const targetItem = typeof target === "object" && target !== null ? target : queue.find((item) => String(item.id) === String(target));
    const id = targetItem?.id || target;
    const statusInfo = getQueueStatusInfo(targetItem || { id }, { source: "action", queueType: targetItem?.content_type || targetItem?.strategy_type || "queue" });
    logQueueAuditDebug("[queue-action]", {
      ...statusInfo,
      action,
      endpointId: id,
      canApprove: canApproveQueueItem(targetItem),
      canPublish: canPublishQueueItem(targetItem),
      matchedStateItem: Boolean(targetItem),
    });
    let reloaded = false;
    if (!id) {
      toast.error("Queue item is missing an id. Queue updated.");
      await load({ logQueueCount: true });
      return;
    }
    const targetFlags = getPreviewContentFlags(targetItem || {});
    if (action === "publish" && targetFlags.isStoryContent && !targetFlags.isFeedContent) {
      if (storyAssetRequestsRef.current.has(String(id)) || generatingStoryAssetIds.has(String(id))) {
        toast.error("انتظر حتى يكتمل إنشاء أصل القصة أولًا.");
        return;
      }
      if (!hasValidStoryAssetSnapshot(targetItem || {})) {
        toast.error("أنشئ أصل القصة أولًا من زر المعاينة، ثم أعد محاولة النشر.");
        return;
      }
    }
    if (action === "publish" && !canPublishQueueItem(targetItem)) {
      toast(isPublishedQueueItem(targetItem) ? "هذا العنصر منشور بالفعل." : "وافق على هذا العنصر قبل النشر.");
      const nextQueue = await load();
      setPreview((current) => (current && String(current.id) === String(id) ? (action === "delete" ? null : nextQueue.find((item) => String(item.id) === String(id)) || current) : current));
      return;
    }
    if (action === "approve" && !canApproveQueueItem(targetItem)) {
      toast(isPublishedQueueItem(targetItem) ? "هذا العنصر منشور بالفعل." : "هذا العنصر ليس بانتظار الموافقة.");
      const nextQueue = await load();
      setPreview((current) => (current && String(current.id) === String(id) ? nextQueue.find((item) => String(item.id) === String(id)) || current : current));
      return;
    }
    try {
      if (action === "approve") await approveAutonomousAiMarketingQueueItem(id);
      if (action === "archive") await archiveAutonomousAiMarketingQueueItem(id);
      if (action === "restore") await restoreAutonomousAiMarketingQueueItem(id);
      if (action === "duplicate") await duplicateAutonomousAiMarketingQueueItem(id);
      if (action === "publish") {
        setPublishingIds((current) => new Set(current).add(String(id)));
        if (statusInfo.normalizedStatus === "pending_approval") {
          await approveAutonomousAiMarketingQueueItem(id);
        }
        await publishAutonomousAiMarketingQueueItemNow(id);
        const { isStoryContent } = getPreviewContentFlags(targetItem);
        toast.success(isStoryContent ? "تم نشر الاستوري بنجاح" : "تم نشر المحتوى بنجاح");
      }
      if (action === "delete") {
        if (!targetItem?.confirmedDelete) {
          setDeleteTarget(targetItem || { id });
          return;
        }
        logQueueDeleteDebug({ itemIdBeingDeleted: id });
        const result = await deleteAutonomousAiMarketingQueueItem(id);
        logQueueDeleteDebug({ responseStatus: result?.status ?? null });
        if (Number(result?.status) === 404) {
          setQueue((current) => current.filter((item) => String(item.id) !== String(id)));
        }
      }
      const nextQueue = await load({ logQueueCount: action === "delete" });
      setPreview((current) => (current && String(current.id) === String(id) ? nextQueue.find((item) => String(item.id) === String(id)) || current : current));
      setSelectedIds((current) => {
        const next = new Set(current);
        if (["delete", "archive"].includes(action)) next.delete(String(id));
        return next;
      });
      reloaded = true;
    } catch (error) {
      if (isStaleQueueError(error)) {
        setQueue((current) => current.filter((item) => String(item.id) !== String(id)));
        setPreview((current) => (current && String(current.id) === String(id) ? null : current));
        await load({ logQueueCount: true });
        reloaded = true;
        toast.error("This item was already removed or refreshed. Queue updated.");
      } else {
        toast.error(formatApiError(error, "Queue action failed"));
      }
    } finally {
      if (!reloaded) {
        await load({ logQueueCount: action === "delete" });
      }
      if (action === "publish") {
        setPublishingIds((current) => {
          const next = new Set(current);
          next.delete(String(id));
          return next;
        });
      }
    }
  };
  const generateStoryAsset = (item) => {
    const id = item?.id;
    if (!id) {
      toast.error("Queue item is missing an id.");
      return Promise.resolve(null);
    }
    const key = String(id);
    const existingRequest = storyAssetRequestsRef.current.get(key);
    if (existingRequest) return existingRequest;
    const request = (async () => {
      try {
        setGeneratingStoryAssetIds((current) => new Set(current).add(key));
        const payload = await generateAutonomousAiMarketingQueueStoryAsset(id);
        let updatedItem = mergeStoryAssetResponse(item, payload);
        if (!hasValidStoryAssetSnapshot(updatedItem)) {
          for (let attempt = 0; attempt < 48; attempt += 1) {
            await wait(2500);
            const rows = await load({ silent: true });
            const latest = rows.find((row) => String(row.id) === key);
            if (!latest) throw new Error("لم يعد عنصر القصة موجودًا في قائمة الانتظار.");
            if (String(latest.metadata?.story_asset_error || "").trim() || getQueueStatusInfo(latest).normalizedStatus === "failed") {
              throw new Error(latest.metadata?.story_asset_error || "فشل إنشاء أصل القصة.");
            }
            updatedItem = mergeStoryAssetResponse(item, latest);
            if (hasValidStoryAssetSnapshot(updatedItem)) break;
          }
        }
        if (!hasValidStoryAssetSnapshot(updatedItem)) throw new Error("انتهت مهلة إنشاء أصل القصة. حاول مرة أخرى.");
        if (normalizeStoryAssetSnapshot(updatedItem).storyId !== key) throw new Error("تم تجاهل استجابة أصل قصة لا تخص هذا الصف.");
        setQueue((current) => current.map((row) => (String(row.id) === key ? updatedItem : row)));
        setPreview((current) => (current && String(current.id) === key ? updatedItem : current));
        toast.success("تم إنشاء أصل القصة وحفظه.");
        return updatedItem;
      } catch (error) {
        const message = formatApiError(error, "فشل إنشاء أصل القصة.");
        setPreview((current) =>
          current && String(current.id) === key
            ? { ...current, metadata: { ...(current.metadata || {}), story_asset_error: message } }
            : current
        );
        toast.error(message);
        return null;
      } finally {
        setGeneratingStoryAssetIds((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        storyAssetRequestsRef.current.delete(key);
      }
    })();
    storyAssetRequestsRef.current.set(key, request);
    return request;
  };

  const previewQueueItem = (item) => {
    setPreview(item);
  };

  const confirmDeleteContent = async () => {
    if (!deleteTarget?.id) return;
    const target = { ...deleteTarget, confirmedDelete: true };
    setDeleteTarget(null);
    await updateQueueItem(target, "delete");
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runBulkAction = async (action) => {
    const ids = Array.from(selectedIds);
    if (!ids.length) {
      toast("Select content first.");
      return;
    }
    if (action === "delete") {
      setDeleteTarget({ bulk: true, ids, id: ids[0], title: `${ids.length} selected items` });
      return;
    }
    if (action === "publish") {
      const missingStoryAssets = queue.filter((item) => {
        if (!ids.includes(String(item.id)) && !ids.includes(item.id)) return false;
        const flags = getPreviewContentFlags(item);
        return flags.isStoryContent && !flags.isFeedContent && !hasValidStoryAssetSnapshot(item);
      });
      if (missingStoryAssets.length) {
        toast.error("أنشئ أصول القصص المحددة أولًا قبل النشر الجماعي.");
        return;
      }
    }
    try {
      const result = await bulkAutonomousAiMarketingQueueAction({ action, ids });
      toast.success(`${result?.affected || 0} item${Number(result?.affected || 0) === 1 ? "" : "s"} updated`);
      setSelectedIds(new Set());
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Bulk action failed"));
    }
  };

  const confirmBulkDelete = async () => {
    const ids = Array.isArray(deleteTarget?.ids) ? deleteTarget.ids : [];
    if (!ids.length) return;
    try {
      const result = await bulkAutonomousAiMarketingQueueAction({ action: "delete", ids });
      toast.success(`${result?.affected || 0} item${Number(result?.affected || 0) === 1 ? "" : "s"} deleted`);
      setSelectedIds(new Set());
      setDeleteTarget(null);
      await load({ logQueueCount: true });
    } catch (error) {
      toast.error(formatApiError(error, "Bulk delete failed"));
    }
  };

  const openHistory = async (item) => {
    if (!item?.id) return;
    setHistoryTarget(item);
    try {
      setHistoryRows(await getAutonomousAiMarketingQueueTimeline(item.id));
    } catch (error) {
      setHistoryRows([]);
      toast.error(formatApiError(error, "تعذر تحميل سجل المحتوى"));
    }
  };

  const setAutomationActive = async (active) => {
    try {
      const payload = active ? await resumeAutonomousAiMarketing() : await pauseAutonomousAiMarketing();
      setSettings((current) => ({ ...current, ...unwrapSettings(payload) }));
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Unable to update automation status"));
    }
  };

  const syncInsights = async () => {
    try {
      setSyncingInsights(true);
      const response = await syncAutonomousAiMarketingInsights();
      logInsightsSyncDebug(response);
      const nextInsights = normalizeInsightResponse(response);
      setOverview((current) => ({ ...current, posting_insights: nextInsights }));
      toast.success("Posting insights synced");
      await load();
      setOverview((current) => ({ ...current, posting_insights: nextInsights }));
    } catch (error) {
      toast.error(formatApiError(error, "تعذر مزامنة بيانات النشر"));
    } finally {
      setSyncingInsights(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a12] p-4 text-white md:p-6">
      <AiMarketingCenterNav />
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
            <Bot className="h-4 w-4" />
            AI Marketing Engine
          </div>
          <h1 className="mt-3 text-3xl font-black md:text-4xl">Stories and posts that stay clean</h1>
          <div className="mt-2 inline-flex rounded-full border border-amber-300/25 bg-amber-400/10 px-3 py-1 text-xs font-black text-amber-100">
            AI Queue
          </div>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-400">
            Focused generation for new arrivals, real last-piece variants, and premium AI product posts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => load()} disabled={loading} className={`${buttonClass} border border-white/10 bg-white/10 text-white hover:bg-white/15`}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button type="button" onClick={saveSettings} disabled={saving} className={`${buttonClass} border border-cyan-300/30 bg-cyan-300 text-slate-950 hover:bg-cyan-200`}>
            <Check className="h-4 w-4" />
            Save
          </button>
          <button type="button" onClick={() => runGeneration("daily")} disabled={running || !canCreateMarketing} className={`${buttonClass} bg-white text-slate-950 hover:bg-cyan-100`}>
            <Wand2 className="h-4 w-4" />
            {running ? "في الطابور..." : canCreateMarketing ? "إنشاء الطابور" : "لا توجد صلاحية إنشاء"}
          </button>
        </div>
      </div>

      {activeGenerationCount ? (
        <div className="rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-3 text-sm font-bold text-cyan-100">
          {activeGenerationCount} generation job{activeGenerationCount === 1 ? "" : "s"} running in the background. This page will update automatically.
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-4">
        <Kpi label="حالة الذكاء الاصطناعي" value={overview.ai_status || (settings.active ? "نشط" : "متوقف مؤقتًا")} tone={settings.active ? "emerald" : "amber"} />
        <Kpi label="Stories Generated Today" value={overview.stories_generated_today || 0} />
        <Kpi label="Posts Generated Today" value={overview.posts_generated_today || 0} />
        <Kpi label="بانتظار الموافقة" value={overview.pending_approval || 0} tone="amber" />
      </section>

      <div className="mt-4 grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className={`${cardClass} p-5`}>
            <SectionTitle icon={<Sparkles className="h-4 w-4" />} title="Content Lanes" />
            <div className="mt-4 grid gap-3">
              <StrategyCard title="New Arrivals" text="Newest active products with stock and usable images." checked={settings.active_strategies?.new_arrivals !== false} onChange={(value) => toggleStrategy("new_arrivals", value)} />
              <StrategyCard title="آخر مقاس / آخر قطعة" text="يعرض فقط المتغيرات القابلة للبيع مع مخزون 1-2." checked={settings.active_strategies?.last_size !== false} onChange={(value) => toggleStrategy("last_size", value)} />
              <StrategyCard title="AI Posts" text="Single product and carousel posts with captions and hashtags." checked={settings.active_strategies?.ai_posts !== false} onChange={(value) => toggleStrategy("ai_posts", value)} />
            </div>
          </section>

          <section className={`${cardClass} p-5`}>
            <SectionTitle icon={<Grid2X2 className="h-4 w-4" />} title="Daily Volume" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <NumberField label="Stories" value={settings.stories_per_day} onChange={(value) => patchSettings({ stories_per_day: value })} />
              <NumberField label="Posts" value={settings.posts_per_day} onChange={(value) => patchSettings({ posts_per_day: value })} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setAutomationActive(false)} className={`${buttonClass} border border-amber-300/20 bg-amber-400/10 text-amber-100`}>
                <Pause className="h-4 w-4" />
                Pause
              </button>
              <button type="button" onClick={() => setAutomationActive(true)} className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100`}>
                <Play className="h-4 w-4" />
                Resume
              </button>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button type="button" onClick={() => runGeneration("daily")} disabled={running || !canCreateMarketing} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white hover:bg-white/10`}>
                Generate Today
              </button>
              <button type="button" onClick={() => runGeneration("weekly")} disabled={running || !canCreateMarketing} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white hover:bg-white/10`}>
                Generate Week
              </button>
              <button type="button" onClick={() => runGeneration("monthly")} disabled={running || !canCreateMarketing} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white hover:bg-white/10`}>
                Generate Month
              </button>
            </div>
          </section>

          <section className={`${cardClass} p-5`}>
          <SectionTitle icon={<Archive className="h-4 w-4" />} title="إدارة التنظيف" />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <NumberField label="الأرشفة بعد أيام" value={settings.auto_archive_published_after_days} onChange={(value) => patchSettings({ auto_archive_published_after_days: value })} />
              <NumberField label="Delete archived after days" value={settings.auto_delete_archived_after_days} onChange={(value) => patchSettings({ auto_delete_archived_after_days: value })} />
            </div>
          </section>

          <InsightCard insights={overview.posting_insights} syncing={syncingInsights} onSync={syncInsights} />
        </aside>

        <main className="space-y-4">
          <RecommendationsPanel overview={overview} />
          <QueueSection title="القصص" icon={<Image className="h-4 w-4" />} items={stories} empty="لا توجد عناصر قصة في الطابور." statusFilter={storyStatusFilter} onStatusFilter={setStoryStatusFilter} selectedIds={selectedIds} onToggleSelected={toggleSelected} onBulkAction={runBulkAction} onPreview={previewQueueItem} onHistory={openHistory} onAction={updateQueueItem} publishingIds={publishingIds} generatingStoryAssetIds={generatingStoryAssetIds} actionDisabled={loading} />
          <QueueSection title="المنشورات" icon={<Send className="h-4 w-4" />} items={posts} empty="لا توجد منشورات ذكاء اصطناعي في الطابور." statusFilter={postStatusFilter} onStatusFilter={setPostStatusFilter} selectedIds={selectedIds} onToggleSelected={toggleSelected} onBulkAction={runBulkAction} onPreview={previewQueueItem} onHistory={openHistory} onAction={updateQueueItem} publishingIds={publishingIds} generatingStoryAssetIds={generatingStoryAssetIds} actionDisabled={loading} />
        </main>
      </div>

      {preview ? (
        <PreviewModal
          item={preview}
          onClose={() => setPreview(null)}
          onApprove={() => updateQueueItem(preview, "approve")}
          onPublish={() => updateQueueItem(preview, "publish")}
          onGenerateStoryAsset={() => generateStoryAsset(preview)}
          generatingStoryAsset={generatingStoryAssetIds.has(String(preview.id))}
        />
      ) : null}
      {deleteTarget ? (
        <DeletePublishedContentModal
          target={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={deleteTarget.bulk ? confirmBulkDelete : confirmDeleteContent}
        />
      ) : null}
      {historyTarget ? (
        <ContentHistoryModal target={historyTarget} rows={historyRows} onClose={() => setHistoryTarget(null)} />
      ) : null}
    </div>
  );
}

function Kpi({ label, value, tone = "cyan" }) {
  const color = tone === "emerald" ? "text-emerald-200" : tone === "amber" ? "text-amber-200" : "text-cyan-100";
  return (
    <div className={`${cardClass} p-4`}>
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-3 text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function SectionTitle({ icon, title }) {
  return (
    <div className="flex items-center gap-2 text-lg font-black">
      <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/15 bg-cyan-300/10 text-cyan-100">{icon}</span>
      {title}
    </div>
  );
}

function StrategyCard({ title, text, checked, onChange }) {
  return (
    <label className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <span>
        <span className="block text-sm font-black text-white">{title}</span>
        <span className="mt-1 block text-xs font-semibold leading-5 text-slate-400">{text}</span>
      </span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} className="mt-1" />
    </label>
  );
}

function NumberField({ label, value, onChange }) {
  return (
    <label>
      <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</span>
      <input className={inputClass} min="0" type="number" value={value || 0} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

const formatInsightWindow = (window = {}) => {
  const label = String(window.label || "").trim();
  if (label) return label;
  const start = Number(window.start || 0);
  const hour = Math.floor(start / 60);
  const minute = start % 60;
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
};

const formatInsightSyncedAt = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
};

const normalizeInsightResponse = (payload = {}) => {
  const nested = payload?.insights && typeof payload.insights === "object" ? payload.insights : {};
  const source = String(payload?.source || nested.source || "fallback");
  const windows = Array.isArray(payload?.windows)
    ? payload.windows
    : Array.isArray(nested.best_windows)
      ? nested.best_windows
      : [];
  const fallbackReason = String(payload?.fallback_reason || payload?.message || nested.reason || nested.engagement_scores?.reason || "").trim();
  return {
    ...nested,
    ...payload,
    source,
    best_windows: windows,
    fallback_reason: fallbackReason,
    reason: fallbackReason || nested.reason || "",
    message: payload?.message || nested.message || fallbackReason,
    last_synced_at: payload?.last_synced_at || nested.last_synced_at || null,
    diagnostics: payload?.diagnostics || nested.diagnostics || {},
  };
};

const insightStateText = (insights, syncing) => {
  if (syncing) return "Syncing insights...";
  const source = String(insights?.source || "fallback");
  const status = String(insights?.status || "");
  const reason = String(insights?.fallback_reason || insights?.reason || insights?.message || "").trim();
  if (source !== "fallback") return "يتم استخدام رؤى إنستجرام/فيسبوك";
  if (status === "permission_missing") return "Permission missing: insights permission required";
  if (status === "missing_token") return "Meta connected token is missing";
  if (status === "no_insights") return reason || "Connected but no insights yet";
  if (status === "api_error") return reason || "Meta API error";
  return reason || "Using fallback";
};

function InsightCard({ insights, syncing = false, onSync }) {
  const normalizedInsights = normalizeInsightResponse(insights || {});
  const source = String(normalizedInsights?.source || "fallback");
  const usingFallback = source === "fallback";
  const windows = !usingFallback && Array.isArray(normalizedInsights?.best_windows) ? normalizedInsights.best_windows.slice(0, 3) : [];
  const sourceLabel = source.replaceAll("_", " ");
  const syncedAt = formatInsightSyncedAt(normalizedInsights?.last_synced_at);
  const stateText = insightStateText(normalizedInsights, syncing);
  const diagnostics = normalizedInsights?.diagnostics || {};
  const fallbackReason = String(normalizedInsights?.fallback_reason || normalizedInsights?.reason || normalizedInsights?.message || "").trim();
  return (
    <section className={`${cardClass} p-5`}>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={<Clock className="h-4 w-4" />} title="Best Posting Windows" />
        <button type="button" onClick={onSync} disabled={syncing} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-400/10 px-3 text-xs font-black text-cyan-100 transition hover:bg-cyan-400/20 disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          Sync
        </button>
      </div>
      <div className="mt-4 grid gap-2">
        {windows.length ? windows.map((window, index) => (
          <div key={`${window.id || "window"}-${index}`} className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 px-3 py-2.5">
            <span className="text-sm font-black text-white">{formatInsightWindow(window)}</span>
            <Badge tone={window.source === "fallback" ? "slate" : "cyan"}>{window.source === "fallback" ? "fallback" : "Meta"}</Badge>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-4 text-sm font-semibold text-slate-500">
            {syncing ? "Syncing insights..." : usingFallback ? (fallbackReason || "Static fallback windows active") : "Connected but no insights yet"}
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-1 text-xs font-bold text-slate-500">
        <div>{stateText}</div>
        {syncedAt ? <div>Last synced at {syncedAt}</div> : null}
        <div className="capitalize">Source: {sourceLabel}</div>
        {Number.isFinite(Number(diagnostics.analytics_rows_count)) ? <div>Analytics rows: {diagnostics.analytics_rows_count}</div> : null}
        {diagnostics.meta_error ? <div>Meta API error: {diagnostics.meta_error}</div> : null}
      </div>
    </section>
  );
}

function QueueSection({ title, icon, items, empty, statusFilter = "all", onStatusFilter, selectedIds, onToggleSelected, onBulkAction, onPreview, onHistory, onAction, publishingIds, generatingStoryAssetIds, actionDisabled = false }) {
  const groups = groupedBySchedule(items);
  const queueType = title.toLowerCase();
  const selectedCount = items.filter((item) => selectedIds?.has(String(item.id))).length;
  return (
    <section className={`${cardClass} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={icon} title={title} />
        <div className="flex flex-wrap items-center gap-2">
          <select value={statusFilter} onChange={(event) => onStatusFilter?.(event.target.value)} className="h-10 rounded-xl border border-white/10 bg-black/30 px-3 text-xs font-black text-white outline-none">
            {QUEUE_FILTERS.map((filter) => <option key={filter.value} value={filter.value} className="bg-slate-950">{filter.label}</option>)}
          </select>
          <Badge>{items.length} shown</Badge>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2">
        <Badge>{selectedCount} selected</Badge>
        <button type="button" disabled={!selectedCount} onClick={() => onBulkAction?.("archive")} className={`${buttonClass} border border-amber-300/20 bg-amber-400/10 text-amber-100`}>أرشفة المحدد</button>
        <button type="button" disabled={!selectedCount} onClick={() => onBulkAction?.("delete")} className={`${buttonClass} border border-rose-300/20 bg-rose-400/10 text-rose-100`}>Delete Selected</button>
        <button type="button" disabled={!selectedCount} onClick={() => onBulkAction?.("publish")} className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100`}>نشر المحدد</button>
      </div>
      <div className="mt-4 grid gap-3">
        {groups.length ? groups.map((group) => (
          <div key={`${title}-${group.label}`} className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{group.label}</div>
              <Badge>{group.items.length}</Badge>
            </div>
            {group.items.map((item) => (
              <QueueItem key={item.id} item={item} queueType={queueType} selected={selectedIds?.has(String(item.id))} onToggleSelected={() => onToggleSelected?.(item.id)} publishing={publishingIds?.has(String(item.id))} generatingStoryAsset={generatingStoryAssetIds?.has(String(item.id))} actionDisabled={actionDisabled} onPreview={() => onPreview(item)} onHistory={() => onHistory?.(item)} onApprove={() => onAction(item, "approve")} onPublish={() => onAction(item, "publish")} onArchive={() => onAction(item, "archive")} onRestore={() => onAction(item, "restore")} onDuplicate={() => onAction(item, "duplicate")} onDelete={() => onAction(item, "delete")} />
            ))}
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-sm font-semibold text-slate-500">{empty}</div>
        )}
      </div>
    </section>
  );
}

function Badge({ children, tone = "slate" }) {
  const toneClass = tone === "cyan" ? "border-cyan-300/25 bg-cyan-400/10 text-cyan-100" : tone === "amber" ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : tone === "emerald" ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : tone === "rose" ? "border-rose-300/25 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/[0.06] text-slate-300";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${toneClass}`}>{children}</span>;
}

function ScheduleBadge({ item }) {
  return <Badge tone="cyan">{formatSchedule(item)}</Badge>;
}

function QueueItem({ item, queueType = "queue", selected = false, onToggleSelected, publishing, generatingStoryAsset = false, actionDisabled = false, onPreview, onHistory, onApprove, onPublish, onArchive, onRestore, onDuplicate, onDelete }) {
  const design = item.design_json || {};
  const isLastPiece = item.strategy_type === "last_size";
  const { isStoryContent, isFeedContent } = getPreviewContentFlags(item);
  const contentLabel = isFeedContent ? String(design.layout_type || "post").replaceAll("_", " ") : String(item.strategy_type || "story").replaceAll("_", " ");
  const platformResults = item.platform_publish_results || {};
  const publishedPlatforms = Array.isArray(item.published_platforms) ? item.published_platforms : [];
  const hasFacebook = publishedPlatforms.includes("facebook") || platformResults.facebook?.status === "published";
  const hasInstagram = publishedPlatforms.includes("instagram") || platformResults.instagram?.status === "published";
  const hasFailedPlatform = Object.values(platformResults).some((value) => value?.status && !["published", "skipped"].includes(value.status));
  const sizesLabel = sizesLabelFrom(design, item);
  const statusInfo = getQueueStatusInfo(item, { source: "card", queueType, publishing });
  const normalizedStatus = statusInfo.normalizedStatus;
  const displayStatus = statusInfo.displayStatus;
  const isArchived = normalizedStatus === "archived";
  const showApprove = canApproveQueueItem(item);
  const showPublish = canPublishQueueItem(item);
  const postUrl = queuePostUrl(item);
  const performanceScore = Number(item.performance_score || item.metadata?.performance_score || 0);
  const performanceLabel = item.performance_label || item.metadata?.performance_label || (performanceScore >= 70 ? "High Performer" : performanceScore >= 40 ? "Average" : performanceScore > 0 ? "Low Performer" : "No Data");
  useEffect(() => {
    logQueueAuditDebug("[queue-card]", {
      ...statusInfo,
      badgeStatus: displayStatus,
      approveVisible: showApprove,
      publishVisible: showPublish,
      approveEndpointId: item.id,
      publishEndpointId: item.id,
    });
    logQueueAuditDebug("[queue-status]", statusInfo);
  }, [displayStatus, item.id, item.publish_status, item.status, item.post_status, item.state, normalizedStatus, queueType, showApprove, showPublish, statusInfo]);
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[auto_72px_minmax(0,1fr)_auto] md:items-center">
      <input type="checkbox" checked={selected} onChange={onToggleSelected} className="h-4 w-4" aria-label="Select content" />
      <Thumb item={item} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={isFeedContent ? "cyan" : "slate"}>{isStoryContent && !isFeedContent ? "story" : item.content_type}</Badge>
          <Badge>{contentLabel}</Badge>
          {isFeedContent && (design.color_name || item.color) ? <Badge>{design.color_name || item.color}</Badge> : null}
          <Badge>{platformLabel(item)}</Badge>
          <Badge tone={normalizedStatus === "published" ? "emerald" : normalizedStatus === "archived" ? "amber" : ["failed", "publish_failed"].includes(normalizedStatus) ? "rose" : displayStatus === "Publishing" || normalizedStatus === "publishing" ? "amber" : "slate"}>{displayStatus === "Publishing" ? "جارٍ النشر" : displayStatus}</Badge>
          {sizesLabel ? <Badge tone={isLastPiece ? "amber" : "slate"}>{sizesLabel}</Badge> : null}
          {isLastPiece && design.stock ? <Badge tone="amber">stock {design.stock}</Badge> : null}
          {design.audio ? <Badge tone="cyan"><Music2 className="h-3 w-3" /> Arabic Trend</Badge> : null}
          <Badge tone={performanceScore >= 70 ? "emerald" : performanceScore >= 40 ? "amber" : performanceScore > 0 ? "rose" : "slate"}>{performanceLabel}</Badge>
          {hasFacebook ? <Badge tone="cyan">فيسبوك</Badge> : null}
          {hasInstagram ? <Badge tone="cyan">إنستجرام</Badge> : null}
        </div>
        <div className="mt-2 truncate text-sm font-black text-white">{item.title || design.product_name || "محتوى في الطابور"}</div>
        <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-400" dir="rtl">{isStoryContent && !isFeedContent ? storyQueueCaption(item) : item.caption}</div>
        {normalizedStatus === "published" || normalizedStatus === "publish_failed" ? (
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black">
            <span className={hasFacebook ? "text-emerald-200" : "text-rose-200"}>فيسبوك: {hasFacebook ? "سليم" : "فشل"}</span>
            <span className={hasInstagram ? "text-emerald-200" : "text-rose-200"}>إنستجرام: {hasInstagram ? "سليم" : "فشل"}</span>
            {item.platform_error_message || item.publish_error ? <span className="text-rose-200">{item.platform_error_message || item.publish_error}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="grid gap-2 md:justify-items-end">
        <div className="flex w-full md:justify-end">
          <ScheduleBadge item={item} />
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <button type="button" onClick={onPreview} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>Preview</button>
          <button type="button" onClick={onHistory} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>
            <History className="h-4 w-4" />
            History
          </button>
          {normalizedStatus === "published" && postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100`}>عرض المنشور</a> : null}
          {isArchived ? <button type="button" onClick={onRestore} disabled={actionDisabled} className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100`}>استعادة</button> : null}
          {!isArchived && showApprove ? <button type="button" onClick={onApprove} disabled={actionDisabled} className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100`}>موافقة</button> : null}
          {!isArchived && showPublish ? <button type="button" onClick={onPublish} disabled={publishing || generatingStoryAsset || actionDisabled} className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100`}>{publishing ? "جارٍ النشر..." : normalizedStatus === "publish_failed" || hasFailedPlatform ? "إعادة محاولة النشر" : "نشر"}</button> : null}
          {!isArchived ? <button type="button" onClick={onArchive} disabled={actionDisabled} className={`${buttonClass} border border-amber-300/20 bg-amber-400/10 text-amber-100`}>أرشفة</button> : null}
          <button type="button" title="Duplicate" onClick={onDuplicate} disabled={actionDisabled} className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
            <Copy className="h-4 w-4" />
          </button>
          {normalizedStatus === "failed" ? <button type="button" onClick={onPreview} className={`${buttonClass} border border-amber-300/20 bg-amber-400/10 text-amber-100`}>Retry</button> : null}
          <button type="button" title="Delete" onClick={onDelete} className="grid h-10 w-10 place-items-center rounded-xl border border-rose-300/20 bg-rose-400/10 text-rose-100">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Thumb({ item }) {
  const { isFeedContent, isStoryContent } = getPreviewContentFlags(item);
  const isPost = isFeedContent && !isStoryContent;
  const imageUrl = isStoryContent ? queueStoryAssetUrl(item) || item.primary_image_url || uniqueMediaUrls(item)[0] || "" : item.primary_image_url || uniqueMediaUrls(item)[0] || "";
  return (
    <div className={`relative overflow-hidden rounded-xl border border-white/10 bg-slate-950 ${isPost ? "aspect-square w-16" : "aspect-[9/16] w-16"}`}>
      {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" /> : null}
    </div>
  );
}

function DebugUrlRow({ label, value }) {
  const displayValue = String(value || "").trim();
  return (
    <div className="grid gap-1 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      {displayValue ? (
        <a href={displayValue} target="_blank" rel="noreferrer" className="break-all text-xs font-bold text-cyan-200 underline decoration-cyan-300/40 underline-offset-4">
          {displayValue}
        </a>
      ) : (
        <div className="text-xs font-black text-rose-200">{label}: MISSING</div>
      )}
    </div>
  );
}

function GeneratedStoryAssetPreview({ urls = [], selectedIndex = 0, onSelect }) {
  const selectedUrl = urls[selectedIndex] || urls[0] || "";
  return (
    <div className="grid gap-4 rounded-3xl border border-white/10 bg-black/30 p-4 md:grid-cols-[minmax(0,1fr)_150px]">
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">Generated story asset</h3>
          <Badge tone="emerald">{urls.length} rendered</Badge>
        </div>
        <div className="mx-auto aspect-[9/16] max-h-[72vh] overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-2xl">
          {selectedUrl ? (
            <img src={selectedUrl} alt={`Generated story slide ${selectedIndex + 1}`} className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm font-bold text-slate-400">No generated story asset</div>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Story Slides</div>
        <div className="grid max-h-[72vh] gap-3 overflow-y-auto pr-1">
          {urls.map((url, index) => (
            <button
              key={`${url}-${index}`}
              type="button"
              onClick={() => onSelect?.(index)}
              className={`overflow-hidden rounded-2xl border bg-slate-950 text-left transition ${
                index === selectedIndex ? "border-cyan-300 ring-2 ring-cyan-300/30" : "border-white/10 hover:border-white/30"
              }`}
            >
              <div className="aspect-[9/16] w-full overflow-hidden bg-slate-900">
                <img src={url} alt={`Generated thumbnail ${index + 1}`} className="h-full w-full object-cover" />
              </div>
              <div className="truncate px-2 py-2 text-xs font-black text-white">Slide {index + 1}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecommendationsPanel({ overview = {} }) {
  const recommendations = Array.isArray(overview.performance_recommendations) ? overview.performance_recommendations : [];
  const brains = Array.isArray(overview.ai_operating_brains) ? overview.ai_operating_brains : [];
  const insufficient = overview.performance_insufficient_data || recommendations.length === 0;
  return (
    <section className={`${cardClass} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle icon={<Sparkles className="h-4 w-4" />} title="AI Recommendations" />
        <Badge tone="cyan">Performance Brain</Badge>
      </div>
      {insufficient ? (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm font-bold text-slate-300">
          {overview.performance_insufficient_data_message || "لا توجد بيانات أداء كافية بعد. انشر المزيد من المحتوى ومزامن الرؤى لعرض التوصيات."}
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {recommendations.map((item, index) => (
            <div key={`${item.type || "recommendation"}-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="text-sm font-black text-white">{item.title}</div>
              <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">{item.reason}</div>
            </div>
          ))}
          </div>
      )}
      {brains.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {brains.map((brain) => <Badge key={brain}>{brain}</Badge>)}
        </div>
      ) : null}
    </section>
  );
}

function DeletePublishedContentModal({ target, onClose, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
        <h2 className="text-xl font-black">حذف المحتوى المنشور</h2>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-300">
          سيؤدي ذلك إلى حذف المحتوى المولّد من قاعدة بيانات مركز التسويق ومن التخزين الوسيط.
          لن يحذف المحتوى تلقائيًا من فيسبوك أو إنستجرام إلا إذا كانت عملية الحذف على المنصة مدعومة صراحةً.
        </p>
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-3 text-sm font-bold text-slate-300">
          {target?.title || target?.caption || (target?.bulk ? `${target.ids?.length || 0} selected items` : `Queue item ${target?.id || ""}`)}
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/10 text-white`}>Cancel</button>
          <button type="button" onClick={onConfirm} className={`${buttonClass} border border-rose-300/30 bg-rose-500 text-white hover:bg-rose-400`}>
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  );
}

function ContentHistoryModal({ target, rows = [], onClose }) {
  const fallbackRows = rows.length ? rows : [
    { action: "created", status: target?.status || "", timestamp: target?.created_at, user: "System" },
  ];
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/75 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-950 p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Content History</h2>
            <p className="mt-1 text-sm font-semibold text-slate-400">{target?.title || "AI marketing content"}</p>
          </div>
          <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/10 text-white`}>Close</button>
        </div>
        <div className="mt-5 grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          {fallbackRows.map((row, index) => (
            <div key={row.id || `${row.action}-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-black capitalize text-white">{String(row.action || "").replaceAll("_", " ")}</div>
                <Badge>{String(row.status || "").replaceAll("_", " ")}</Badge>
              </div>
              <div className="mt-2 text-xs font-bold text-slate-400">
                {row.timestamp ? new Date(row.timestamp).toLocaleString() : "No timestamp"} · {row.user || "System"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ item, onClose, onApprove, onPublish, onGenerateStoryAsset, generatingStoryAsset = false }) {
  const design = item.design_json || {};
  const { isFeedContent } = getPreviewContentFlags(item);
  const statusInfo = getQueueStatusInfo(item, { source: "preview-modal", queueType: isFeedContent ? "posts" : "stories" });
  const showApprove = canApproveQueueItem(item);
  const showPublish = canPublishQueueItem(item);
  const showPublished = isPublishedQueueItem(item);
  const postUrl = queuePostUrl(item);
  const generatedAssetUrls = generatedStoryAssetUrls(item);
  const [selectedGeneratedStoryAssetIndex, setSelectedGeneratedStoryAssetIndex] = useState(0);
  useEffect(() => {
    setSelectedGeneratedStoryAssetIndex(0);
  }, [item.id]);
  useEffect(() => {
    setSelectedGeneratedStoryAssetIndex((current) => Math.min(current, Math.max(generatedAssetUrls.length - 1, 0)));
  }, [generatedAssetUrls.length]);
  useEffect(() => {
    logQueueAuditDebug("[queue-card]", {
      ...statusInfo,
      badgeStatus: statusInfo.displayStatus,
      approveVisible: showApprove,
      publishVisible: showPublish,
      approveEndpointId: item.id,
      publishEndpointId: item.id,
    });
    logQueueAuditDebug("[queue-status]", statusInfo);
  }, [item.id, item.publish_status, item.status, item.post_status, item.state, showApprove, showPublish, statusInfo]);
  if (isFeedContent) {
    const post = normalizeMarketingPostInput(item);
    return (
      <PostEditorModal
        open
        post={post}
        onClose={onClose}
        onPublish={showPublish && onPublish ? () => onPublish(item) : null}
        title="AI post preview"
        actionSlot={
          <div className="grid gap-3">
            {showPublished ? <Badge tone="emerald">منشور</Badge> : null}
            {showPublished && postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100`}>عرض المنشور</a> : null}
            {showApprove ? (
              <button
                type="button"
                onClick={() => onApprove?.(item)}
                className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20`}
              >
                <Check className="h-4 w-4" />
                موافقة
              </button>
            ) : null}
            <details className="rounded-2xl border border-white/10 bg-black/25 p-3">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-400">Technical JSON</summary>
              <pre className="mt-3 max-h-56 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-slate-300">
                {JSON.stringify(design, null, 2)}
              </pre>
            </details>
          </div>
        }
      />
    );
  }
  const mediaUrls = uniqueMediaUrls(item);
  const storySlides = buildStoryCreativeSlides({ item, mediaUrls });
  const renderedStoryAssetUrl = queueStoryAssetUrl(item);
  const sourceImageUrls = sourceStoryImageUrls(item);
  const sourceImagesCount = Number(item.metadata?.source_image_count || design.source_image_count || sourceImageUrls.length || 0);
  const generatedStoryAssetsCount = Number(item.metadata?.generated_asset_count || item.metadata?.generated_slide_count || design.generated_asset_count || generatedAssetUrls.length || 0);
  const renderedSlidesLength = Number(item.metadata?.rendered_slides_length || design.rendered_slides_length || (Array.isArray(design.slides) ? design.slides.length : 0) || 0);
  const mediaUrlsLength = Number(item.metadata?.media_urls_length || design.media_urls_length || (Array.isArray(item.media_urls) ? item.media_urls.length : 0) || 0);
  const storyAudio = storySlides[0]?.audio || design.audio || null;
  const sizesLabel = sizesLabelFrom(storySlides[0], design, item);
  const storyLink = storySlides[0]?.cta_url || storySlides[0]?.product_url || item.cta_url || item.product_url || design.cta_url || design.product_url || "";
  const debugUrls = storyDebugUrls(item);
  const storyAssetError = String(item.metadata?.story_asset_error || design.story_asset_error || "").trim();
  const renderedSnapshot = normalizeStoryAssetSnapshot(item);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
      <div className="grid max-h-[92vh] w-full max-w-6xl gap-5 overflow-y-auto rounded-[28px] border border-white/10 bg-[#090d17] p-5 shadow-2xl lg:grid-cols-[minmax(0,760px)_minmax(300px,1fr)]">
        {generatedAssetUrls.length ? (
          <GeneratedStoryAssetPreview
            urls={generatedAssetUrls}
            selectedIndex={selectedGeneratedStoryAssetIndex}
            onSelect={setSelectedGeneratedStoryAssetIndex}
          />
        ) : renderedStoryAssetUrl ? (
          <div className="rounded-3xl border border-white/10 bg-black/30 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">أصل القصة</h3>
              <Badge tone="emerald">Rendered</Badge>
            </div>
            <div className="mx-auto aspect-[9/16] max-h-[72vh] overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 shadow-2xl">
              <img src={renderedStoryAssetUrl} alt="Rendered story preview" className="h-full w-full object-cover" />
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-amber-300/20 bg-amber-300/[0.04] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-300">معاينة سريعة</h3>
              <Badge tone={generatingStoryAsset ? "amber" : "slate"}>{generatingStoryAsset ? "جارٍ تجهيز الملف النهائي" : "غير منشورة"}</Badge>
            </div>
            <StoryCreativePreview slides={storySlides} title="معاينة الاستوري" />
            <p className="mt-3 text-center text-xs font-bold leading-5 text-slate-400">
              هذه معاينة فورية. استخدم زر إنشاء أصل القصة لحفظ النسخة النهائية الجاهزة للنشر.
            </p>
          </div>
        )}
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">معاينة القصة</h2>
              <p className="mt-2 text-sm font-semibold text-slate-400">9:16 story creative. CTA is a visual sticker here; the product link stays stored for publishing.</p>
            </div>
            <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>Close</button>
          </div>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
            <Info label="Content type" value={item.content_type} />
            <Info label="Layout" value={design.layout_type} />
            <Info label="Sizes" value={sizesLabel || "n/a"} />
            <Info label="رابط القصة" value={storyLink || "غير متاح"} />
          </div>
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4">
            <div className="mb-3 grid gap-2">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-amber-100">Story publish asset debug</div>
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs font-black uppercase tracking-[0.14em] text-amber-100">
                Renderer build: {renderedSnapshot.rendererBuild || "pending generation"}
              </div>
              <button
                type="button"
                onClick={onGenerateStoryAsset}
                disabled={generatingStoryAsset}
                className={`${buttonClass} border border-amber-300/25 bg-amber-300/15 text-amber-100 hover:bg-amber-300/25 disabled:opacity-60`}
              >
                <RefreshCw className={`h-4 w-4 ${generatingStoryAsset ? "animate-spin" : ""}`} />
                {generatingStoryAsset ? "جارٍ إنشاء أصل القصة..." : "إنشاء أصل القصة"}
              </button>
            </div>
            <div className="grid gap-2">
              <Info label="Frontend preview source slides count" value={storySlides.length} />
              <Info label="Source images count" value={sourceImagesCount} />
              <Info label="Generated story assets count" value={generatedAssetUrls.length || generatedStoryAssetsCount || 0} />
              <Info label="Rendered slides length" value={renderedSlidesLength} />
              <Info label="media_urls length" value={mediaUrlsLength} />
              <Info label="Preview thumbnails visible" value={generatedAssetUrls.length} />
              <DebugUrlRow label="productImageUrl" value={debugUrls.productImageUrl} />
              <DebugUrlRow label="rendered_image_url" value={debugUrls.rendered_image_url} />
              <DebugUrlRow label="story_image_url" value={debugUrls.story_image_url} />
              <DebugUrlRow label="final_asset_url" value={debugUrls.final_asset_url} />
              <DebugUrlRow label="selectedPublishUrl" value={debugUrls.selectedPublishUrl} />
              <DebugUrlRow label="final_asset_url_raw" value={debugUrls.final_asset_url_raw} />
              <DebugUrlRow label="selectedPublishUrl_raw" value={debugUrls.selectedPublishUrl_raw} />
              {sourceImageUrls.map((url, index) => (
                <DebugUrlRow key={`source-image-${url}-${index}`} label={`source image ${index + 1}`} value={url} />
              ))}
              {generatedAssetUrls.map((url, index) => (
                <DebugUrlRow key={`generated-story-asset-${url}-${index}`} label={`generated story asset ${index + 1}`} value={url} />
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/80 p-4">
            <div className="mb-3 flex">
              <ScheduleBadge item={item} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {showPublished ? <Badge tone="emerald">منشور</Badge> : null}
              {showPublished && postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100`}>عرض المنشور</a> : null}
              {showApprove ? (
                <button
                  type="button"
                  onClick={() => onApprove?.(item)}
                  className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/20`}
                >
                  <Check className="h-4 w-4" />
                  موافقة
                </button>
              ) : null}
              {showPublish ? (
                <button
                  type="button"
                  onClick={() => onPublish?.(item)}
                  className={`${buttonClass} border border-cyan-300/20 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20`}
                >
                  <Send className="h-4 w-4" />
                  نشر
                </button>
              ) : null}
            </div>
          </div>
          {storyAudio ? (
            <div className="mt-5 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-black text-white">
                <Music2 className="h-4 w-4 text-cyan-200" />
                Suggested Trending Audio
              </div>
              <div className="mt-3 grid gap-2 text-xs font-bold text-slate-300">
                <div className="text-sm font-black text-white">{storyAudio.title || "Arabic trend audio"}</div>
                <div>Mood: {storyAudio.mood || "-"}</div>
                <div>Platform: {storyAudio.platform_hint || "-"}</div>
                <div className="break-words">Search: {storyAudio.search_query || "-"}</div>
              </div>
            </div>
          ) : null}
          <details className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-400">Admin / debug</summary>
            <div className="mt-3 grid gap-3">
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs font-black uppercase tracking-[0.14em] text-amber-100">
                Generation: {renderedSnapshot.generationId || "pending"}
              </div>
              <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.08] p-3 text-xs font-black uppercase tracking-[0.14em] text-amber-100">
                Renderer build: {renderedSnapshot.rendererBuild || "pending generation"}
              </div>
              <Info label="Stored product URL" value={storyLink || "n/a"} />
              {storyAssetError ? (
                <div className="rounded-xl border border-rose-300/25 bg-rose-400/10 p-3 text-xs font-bold leading-5 text-rose-100">
                  خطأ في أصل القصة: {storyAssetError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={onGenerateStoryAsset}
                disabled={generatingStoryAsset}
                className={`${buttonClass} border border-amber-300/25 bg-amber-300/15 text-amber-100 hover:bg-amber-300/25 disabled:opacity-60`}
              >
                <RefreshCw className={`h-4 w-4 ${generatingStoryAsset ? "animate-spin" : ""}`} />
                {generatingStoryAsset ? "جارٍ إنشاء أصل القصة..." : "إنشاء أصل القصة"}
              </button>
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-3">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-amber-100">روابط أصول الصور المنشورة</div>
                <div className="grid gap-2">
                  <DebugUrlRow label="productImageUrl" value={debugUrls.productImageUrl} />
                  <DebugUrlRow label="rendered_image_url" value={debugUrls.rendered_image_url} />
                  <DebugUrlRow label="story_image_url" value={debugUrls.story_image_url} />
                  <DebugUrlRow label="final_asset_url" value={debugUrls.final_asset_url} />
                  <DebugUrlRow label="selectedPublishUrl" value={debugUrls.selectedPublishUrl} />
                  <DebugUrlRow label="final_asset_url_raw" value={debugUrls.final_asset_url_raw} />
                  <DebugUrlRow label="selectedPublishUrl_raw" value={debugUrls.selectedPublishUrl_raw} />
                </div>
              </div>
              <details className="rounded-xl border border-white/10 bg-black/30 p-3">
                <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-500">Technical JSON</summary>
                <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-300">
                  {JSON.stringify(design, null, 2)}
                </pre>
              </details>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 font-bold capitalize text-white">{value || "n/a"}</div>
    </div>
  );
}

export default AiMarketingCenter;
