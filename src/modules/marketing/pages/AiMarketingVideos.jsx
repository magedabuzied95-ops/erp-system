import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Check, Clock, Film, Music2, Pause, Play, RefreshCw, Send, Sparkles, Video, Wand2, X, Zap } from "lucide-react";

import AiMarketingCenterNav from "../components/AiMarketingCenterNav";
import {
  approveAutonomousAiMarketingQueueItem,
  generateAutonomousAiMarketingVideosDaily,
  generateAutonomousAiMarketingVideosMonthly,
  generateAutonomousAiMarketingVideosWeekly,
  getAutonomousAiMarketingQueue,
  getAutonomousAiMarketingSettings,
  pauseAutonomousAiMarketing,
  publishAutonomousAiMarketingQueueItemNow,
  resumeAutonomousAiMarketing,
} from "../services/marketingApi";
import { hasPermission } from "../../permissions/lib/rbacStore";
import { canApproveQueueItem, canPublishQueueItem, getQueueStatusInfo, isPublishedQueueItem, normalizeQueueStatus } from "../lib/queueStatus";

const cardClass = "rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/20 backdrop-blur-xl";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition disabled:cursor-not-allowed disabled:opacity-50";
const inputClass = "h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm font-black text-white outline-none focus:border-primary/50";

const lanes = [
  ["new_arrival_video", "New Arrivals Video"],
  ["last_piece_video", "Last Piece Video"],
  ["product_video", "Product Promo Video"],
  ["offer_video", "Offer Video"],
];

const templatePresets = [
  ["Sneakers Hype Reel", "Cyan/yellow hype cuts, kinetic hook, flash transitions"],
  ["Last Piece Urgency Reel", "Red/amber urgency, stock pulse, hard zoom cuts"],
  ["Luxury Reveal Reel", "Black/gold reveal, soft light sweeps, controlled pacing"],
  ["Offer Blast Reel", "Blue/orange sale energy, price bounce, CTA pulse"],
];

const unwrapSettings = (payload) => payload?.settings || payload || {};
const formatApiError = (error, fallback) => {
  if (Number(error?.status) === 401) return "انتهت الجلسة أو لم يُسمح بالوصول";
  if (Number(error?.status) === 403) return error?.message || "ليست لديك صلاحية استخدام هذا الإجراء في مركز التسويق بالذكاء الاصطناعي";
  return error?.message || fallback;
};

const sceneImageFor = (scene = {}, item = {}) => scene.image_url || scene.media_url || scene.thumbnail_url || item.primary_image_url || item.image_url || item.design_json?.image_url || item.design_json?.media_urls?.[0] || "";
const imageFor = (item = {}) => item.design_json?.scenes?.find((scene) => scene?.image_url)?.image_url || item.primary_image_url || item.image_url || item.design_json?.image_url || item.design_json?.media_urls?.[0] || "";
const videoType = (item = {}) => String(item.design_json?.layout_type || item.strategy_type || "product_video").replaceAll("_", " ");
const firstText = (...values) => values.map((value) => String(value || "").trim()).find(Boolean) || "";
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
const scheduledLabel = (item = {}) => {
  const raw = item.scheduled_at || item.design_json?.scheduled_at;
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : "Not scheduled";
};
const statusTone = (status = "") => {
  const normalized = normalizeQueueStatus(status);
  if (["published", "ready", "approved"].includes(normalized)) return "emerald";
  if (["failed"].includes(normalized)) return "rose";
  if (["generating", "publishing", "pending_generation"].includes(normalized)) return "amber";
  return "slate";
};
const logQueueAuditDebug = (label, payload) => {
  if (typeof console === "undefined" || typeof console.debug !== "function") return;
  console.debug(label, payload);
};
const durationFor = (design = {}) => {
  const stored = Number(design.duration_seconds || 0);
  return stored >= 12 ? stored : 15;
};
const sceneDurationFor = (scene = {}) => Math.max(0.5, Number(scene.scene_duration || scene.duration_seconds || 2));
const formatSeconds = (value = 0) => Number(value).toFixed(Number(value) % 1 ? 1 : 0);
const scenesFor = (item = {}) => {
  const design = item.design_json || {};
  if (Array.isArray(design.scenes) && design.scenes.length) return design.scenes;
  const hook = String(design.layout_type || item.strategy_type || "").includes("last_piece") ? "LAST PIECE" : String(design.layout_type || item.strategy_type || "").includes("offer") ? "LIMITED OFFER" : "NEW DROP";
  const sizes = design.sizes_label || (Array.isArray(design.available_sizes) && design.available_sizes.length ? `AVAILABLE SIZES: ${design.available_sizes.join(", ")}` : design.size_name ? `Size ${design.size_name}` : "Available variants");
  const price = design.price ? `${design.price} ${design.currency || "EGP"}` : "Price reveal";
  return [
    { id: "hook_stop_scroll", role: "hook", label: "Scene 1", title: "Hook / Stop Scroll", caption: hook, image_url: imageFor(item), start: 0, end: 2, duration_seconds: 2, scene_duration: 2, transition: "flash transition", motion: "fast zoom + shake", effect: "shake + flash", visual: `${hook} stop-scroll hook` },
    { id: "product_hero", role: "product", label: "Scene 2", title: "Product Hero", caption: design.product_name || item.title || "Product hero", image_url: design.media_urls?.[1] || imageFor(item), start: 2, end: 5, duration_seconds: 3, scene_duration: 3, transition: "zoom cut", motion: "slow zoom-in + pan", effect: "glow spotlight", visual: "Product enters with radial spotlight" },
    { id: "detail_variant", role: "detail", label: "Scene 3", title: "Detail / Variant", caption: sizes, image_url: design.media_urls?.[2] || imageFor(item), start: 5, end: 7.5, duration_seconds: 2.5, scene_duration: 2.5, transition: "swipe transition", motion: "quick slide animation", effect: "blur-to-focus", visual: sizes },
    { id: "price_pop", role: "price", label: "Scene 4", title: "Price Pop", caption: price, image_url: imageFor(item), start: 7.5, end: 10, duration_seconds: 2.5, scene_duration: 2.5, transition: "zoom cut", motion: "price pop/bounce", effect: "price bounce", visual: price },
    { id: "stock_urgency", role: "urgency", label: "Scene 5", title: "Stock / Size Push", caption: "Available now", image_url: design.media_urls?.[3] || imageFor(item), start: 10, end: 12.5, duration_seconds: 2.5, scene_duration: 2.5, transition: "glow flash", motion: "beat pulse", effect: "light sweep", visual: "Available now | Tap to view details" },
    { id: "cta_close", role: "cta", label: "Scene 6", title: "CTA Close", caption: design.cta_text || "View details", image_url: imageFor(item), start: 12.5, end: 15, duration_seconds: 2.5, scene_duration: 2.5, transition: "fade + final pulse", motion: "CTA glow pulse", effect: "CTA glow pulse", visual: design.cta_text || "View details" },
  ];
};

const readinessChecksFor = (item = {}, scenes = []) => {
  const design = item.design_json || {};
  const audio = audioForVideo(item);
  if (design.readiness_checks) {
    return {
      ...design.readiness_checks,
      has_audio_suggestion: Boolean(audio && Object.keys(audio).length),
    };
  }
  return {
    uses_multiple_images: new Set(scenes.map((scene) => sceneImageFor(scene, item)).filter(Boolean)).size > 1,
    has_hook: scenes.some((scene) => scene.role === "hook" || scene.id === "hook_stop_scroll"),
    has_cta: scenes.some((scene) => scene.role === "cta" || scene.id === "cta_close"),
    has_price: Boolean(design.price || scenes.some((scene) => scene.role === "price" || scene.id === "price_pop")),
    has_audio_suggestion: Boolean(audio && Object.keys(audio).length),
  };
};

const audioForVideo = (item = {}) => {
  const design = item.design_json || {};
  if (design.audio && typeof design.audio === "object" && Object.keys(design.audio).length) {
    return {
      trend_label: design.audio.trend_label || (design.audio.is_trending_label === false ? "مختار" : "رائج"),
      ...design.audio,
    };
  }
  const text = [design.template_preset, design.preset, design.reel_type, design.layout_type, item.strategy_type, design.product_name, item.title].join(" ").toLowerCase();
  if (text.includes("last_piece") || text.includes("last piece") || text.includes("urgency")) {
    return {
      title: "Last Piece Fast Beat",
      mood: "urgent",
      platform_hint: "instagram/facebook",
      search_query: "Arabic fast beat urgency reel audio",
      trend_label: "رائج",
    };
  }
  if (text.includes("luxury") || text.includes("reveal")) {
    return {
      title: "Soft Luxury Arabic",
      mood: "soft luxury",
      platform_hint: "instagram/facebook",
      search_query: "soft luxury Arabic reel audio",
      trend_label: "رائج",
    };
  }
  if (text.includes("offer") || text.includes("blast")) {
    return {
      title: "Arabic Remix Reel Trend",
      mood: "popular remix",
      platform_hint: "instagram/facebook",
      search_query: "Arabic remix trending reel audio",
      trend_label: "رائج",
    };
  }
  return {
    title: "Energetic Sneakers Beat",
    mood: "energetic",
    platform_hint: "instagram/facebook",
    search_query: "Arabic energetic sneakers beat reels",
    trend_label: "رائج",
  };
};

function Badge({ children, tone = "slate" }) {
  const toneClass = tone === "cyan" ? "border-primary/25 bg-primary/10 text-primary" : tone === "amber" ? "border-amber-300/25 bg-amber-400/10 text-amber-100" : tone === "emerald" ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-100" : tone === "rose" ? "border-rose-300/25 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/[0.06] text-slate-300";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-black ${toneClass}`}>{children}</span>;
}

function SectionTitle({ icon: Icon, title }) {
  return (
    <div className="flex items-center gap-2 text-lg font-black text-white">
      <Icon className="h-5 w-5 text-primary" />
      {title}
    </div>
  );
}

export default function AiMarketingVideos() {
  const [settings, setSettings] = useState({});
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [videosPerDay, setVideosPerDay] = useState(4);
  const [preview, setPreview] = useState(null);
  const canCreateMarketing = hasPermission("marketing.create");

  const load = async () => {
    try {
      setLoading(true);
      const [settingsPayload, queueRows] = await Promise.all([
        getAutonomousAiMarketingSettings(),
        getAutonomousAiMarketingQueue({ content_type: "video" }),
      ]);
      const nextSettings = unwrapSettings(settingsPayload);
      const nextQueue = Array.isArray(queueRows) ? queueRows : [];
      setSettings(nextSettings);
      setQueue((current) => {
        const previousIds = current.map((item) => item.id);
        const nextIds = nextQueue.map((item) => item.id);
        logQueueAuditDebug("[queue-status]", {
          source: "api-load",
          queueType: "videos",
          count: nextQueue.length,
          previousIds,
          nextIds,
          staleRemainingIds: previousIds.filter((id) => !nextIds.some((nextId) => String(nextId) === String(id))),
          items: nextQueue.map((item) => getQueueStatusInfo(item, { source: "api-load", queueType: "videos" })),
        });
        return nextQueue;
      });
    } catch (error) {
      toast.error(formatApiError(error, "تعذر تحميل طابور فيديو الذكاء الاصطناعي"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => ({
    total: queue.length,
    ready: queue.filter((item) => ["ready", "approved"].includes(item.status)).length,
    failed: queue.filter((item) => item.status === "failed").length,
  }), [queue]);

  const generate = async (mode) => {
    try {
      setRunning(true);
      const body = { videos_per_day: videosPerDay };
      const result = mode === "month"
        ? await generateAutonomousAiMarketingVideosMonthly(body)
        : mode === "week"
          ? await generateAutonomousAiMarketingVideosWeekly(body)
          : await generateAutonomousAiMarketingVideosDaily(body);
      toast.success(`تم إنشاء ${result?.generated_videos || 0} عنصرًا في طابور الفيديو`);
      await load();
    } catch (error) {
      toast.error(formatApiError(error, "Video generation failed"));
    } finally {
      setRunning(false);
    }
  };

  const action = async (item, type) => {
    const statusInfo = getQueueStatusInfo(item || {}, { source: "action", queueType: "videos" });
    logQueueAuditDebug("[queue-action]", {
      ...statusInfo,
      action: type,
      endpointId: item?.id,
      canApprove: canApproveQueueItem(item),
      canPublish: canPublishQueueItem(item),
      matchedStateItem: Boolean(item),
    });
    if (type === "publish" && !canPublishQueueItem(item)) {
      toast(isPublishedQueueItem(item) ? "هذا العنصر منشور بالفعل." : "وافق على هذا العنصر قبل النشر.");
      await load();
      return;
    }
    if (type === "approve" && !canApproveQueueItem(item)) {
      toast(isPublishedQueueItem(item) ? "هذا العنصر منشور بالفعل." : "هذا العنصر ليس بانتظار الموافقة.");
      await load();
      return;
    }
    try {
      if (type === "approve") await approveAutonomousAiMarketingQueueItem(item.id);
      if (type === "publish") {
        if (statusInfo.normalizedStatus === "pending_approval") {
          await approveAutonomousAiMarketingQueueItem(item.id);
        }
        await publishAutonomousAiMarketingQueueItemNow(item.id);
      }
      await load();
      setPreview((current) => (current && String(current.id) === String(item.id) ? { ...current, status: type === "publish" ? "published" : "approved" } : current));
    } catch (error) {
      toast.error(formatApiError(error, type === "publish" ? "Video publishing is not ready yet" : "Unable to update video"));
      await load();
    }
  };

  const setAutomationActive = async (active) => {
    try {
      const payload = active ? await resumeAutonomousAiMarketing() : await pauseAutonomousAiMarketing();
      setSettings(unwrapSettings(payload));
    } catch (error) {
      toast.error(formatApiError(error, "Unable to update automation status"));
    }
  };

  return (
    <div className="min-h-screen bg-[#070a12] p-4 text-white md:p-6">
      <AiMarketingCenterNav />
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-primary">
            <Video className="h-4 w-4" />
            AI Video Queue
          </div>
          <h1 className="m1-display mt-3">Videos</h1>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-slate-400">
            MVP queue for future MP4, Reels, beat-sync, captions, templates, and TikTok publishing.
          </p>
        </div>
        <button type="button" onClick={load} disabled={loading} className={`${buttonClass} border border-white/10 bg-white/10 text-white hover:bg-white/15`}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <section className="grid gap-3 md:grid-cols-3">
        <Kpi label="Video Queue" value={counts.total} />
        <Kpi label="جاهز / معتمد" value={counts.ready} tone="emerald" />
        <Kpi label="فشل" value={counts.failed} tone={counts.failed ? "rose" : "slate"} />
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="grid gap-5">
          <section className={`${cardClass} p-5`}>
            <SectionTitle icon={Sparkles} title="Content Lanes" />
            <div className="mt-4 grid gap-3">
              {lanes.map(([id, label]) => (
                <div key={id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-black text-white">{label}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-400">{id}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${cardClass} p-5`}>
            <SectionTitle icon={Zap} title="قوالب الفيديو" />
            <div className="mt-4 grid gap-2">
              {templatePresets.map(([name, description]) => (
                <div key={name} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="text-sm font-black text-white">{name}</div>
                  <div className="mt-1 text-xs font-semibold leading-5 text-slate-400">{description}</div>
                </div>
              ))}
            </div>
          </section>

          <section className={`${cardClass} p-5`}>
            <SectionTitle icon={Clock} title="Daily Video Volume" />
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-slate-500">Videos per day</span>
              <input className={inputClass} min="1" max="20" type="number" value={videosPerDay} onChange={(event) => setVideosPerDay(Number(event.target.value || 1))} />
            </label>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => generate("today")} disabled={running || !canCreateMarketing} className={`${buttonClass} bg-white text-slate-950 hover:bg-primary`}>
                <Wand2 className="h-4 w-4" />
                Generate Today
              </button>
              <button type="button" onClick={() => generate("week")} disabled={running || !canCreateMarketing} className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>
                Generate Week
              </button>
              <button type="button" onClick={() => generate("month")} disabled={running || !canCreateMarketing} className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>
                Generate Month
              </button>
              <button type="button" onClick={() => setAutomationActive(!settings.active)} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>
                {settings.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {settings.active ? "Pause" : "Resume"}
              </button>
            </div>
          </section>
        </div>

        <section className={`${cardClass} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <SectionTitle icon={Film} title="Video Queue" />
            <Badge>{queue.length} queued</Badge>
          </div>
          <div className="mt-4 grid gap-3">
            {queue.length ? queue.map((item) => (
              <VideoQueueRow key={item.id} item={item} onPreview={() => setPreview(item)} onApprove={() => action(item, "approve")} onPublish={() => action(item, "publish")} />
            )) : (
              <div className="rounded-2xl border border-dashed border-white/10 bg-black/20 p-8 text-center text-sm font-semibold text-slate-500">
                No videos queued yet.
              </div>
            )}
          </div>
        </section>
      </div>
      {preview ? <VideoPreviewModal item={preview} onClose={() => setPreview(null)} onApprove={() => action(preview, "approve")} onPublish={() => action(preview, "publish")} /> : null}
    </div>
  );
}

function Kpi({ label, value, tone = "cyan" }) {
  const color = tone === "emerald" ? "text-emerald-200" : tone === "rose" ? "text-rose-200" : "text-primary";
  return (
    <div className={`${cardClass} p-4`}>
      <div className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function VideoQueueRow({ item, onPreview, onApprove, onPublish }) {
  const statusInfo = getQueueStatusInfo(item, { source: "card", queueType: "videos" });
  const showApprove = canApproveQueueItem(item);
  const showPublish = canPublishQueueItem(item);
  const postUrl = queuePostUrl(item);
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
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-black/20 p-3 md:grid-cols-[72px_minmax(0,1fr)_auto] md:items-center">
      <div className="relative aspect-[9/16] w-16 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
        {imageFor(item) ? <img src={imageFor(item)} alt="" className="h-full w-full object-cover" /> : <Film className="m-5 h-6 w-6 text-slate-500" />}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="cyan">video</Badge>
          <Badge>{videoType(item)}</Badge>
          <Badge>{scheduledLabel(item)}</Badge>
          <Badge>Instagram</Badge>
          <Badge>Facebook</Badge>
          <Badge>TikTok later</Badge>
          <Badge tone={statusTone(statusInfo.normalizedStatus)}>{statusInfo.displayStatus}</Badge>
        </div>
        <div className="mt-2 truncate text-sm font-black text-white">{item.title || item.design_json?.product_name || "فيديو في الطابور"}</div>
        <div className="mt-1 line-clamp-2 text-xs font-semibold leading-5 text-slate-400">{item.caption}</div>
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        <button type="button" onClick={onPreview} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>Preview</button>
        {statusInfo.normalizedStatus === "published" && postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>عرض المنشور</a> : null}
        {showApprove ? <button type="button" onClick={onApprove} className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100`}>موافقة</button> : null}
        {showPublish ? <button type="button" onClick={onPublish} className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>نشر</button> : null}
      </div>
    </div>
  );
}

function VideoPreviewModal({ item, onClose, onApprove, onPublish }) {
  const design = item.design_json || {};
  const statusInfo = getQueueStatusInfo(item, { source: "preview-modal", queueType: "videos" });
  const showApprove = canApproveQueueItem(item);
  const showPublish = canPublishQueueItem(item);
  const showPublished = isPublishedQueueItem(item);
  const postUrl = queuePostUrl(item);
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
  const audio = audioForVideo(item);
  const scenes = scenesFor(item);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const duration = durationFor(design);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const sceneDurations = useMemo(() => scenes.map(sceneDurationFor), [scenes]);
  const sceneStarts = useMemo(() => sceneDurations.reduce((starts, sceneDuration, index) => {
    const explicitStart = Number(scenes[index]?.start ?? scenes[index]?.start_second);
    starts.push(Number.isFinite(explicitStart) ? explicitStart : index === 0 ? 0 : starts[index - 1] + sceneDurations[index - 1]);
    return starts;
  }, []), [sceneDurations, scenes]);
  const sceneTimelineDuration = Math.max(...scenes.map((scene, index) => Number(scene.end ?? scene.end_second ?? 0) || (sceneStarts[index] || 0) + (sceneDurations[index] || 0)), sceneDurations.reduce((total, sceneDuration) => total + sceneDuration, 0), duration);
  const playbackDuration = Math.max(1, duration || sceneTimelineDuration);
  const sceneTimelinePosition = Math.min(sceneTimelineDuration, (elapsedSeconds / playbackDuration) * sceneTimelineDuration);
  const activeScene = scenes[Math.min(activeSceneIndex, scenes.length - 1)] || scenes[0] || {};
  const activeSceneRole = activeScene.role || (activeScene.id === "hook_stop_scroll" ? "hook" : activeScene.id === "price_pop" ? "price" : activeScene.id === "cta_close" ? "cta" : activeScene.id === "stock_urgency" || activeScene.id === "social_urgency" ? "urgency" : activeScene.id === "detail_variant" ? "detail" : "product");
  const motionStyle = design.motion_style || "slow zoom-in + pan-left";
  const transitionStyle = design.transition_style || "quick flash";
  const reelType = design.reel_type || videoType(item);
  const preset = design.template_preset || design.preset || "Sneakers Hype Reel";
  const hookText = activeScene.id === "hook_stop_scroll" ? (design.hook_frame?.text || activeScene.caption || "NEW DROP") : (activeScene.caption || activeScene.title || "NEW DROP");
  const productTitle = design.product_name || item.title || "Product Video";
  const sceneCaption = activeScene.caption || activeScene.visual || activeScene.title || "";
  const showHookText = activeSceneRole === "hook";
  const showProductTitle = activeSceneRole === "product";
  const showDetailCard = activeSceneRole === "detail";
  const showPriceCard = activeSceneRole === "price";
  const showUrgencyCard = activeSceneRole === "urgency";
  const showCtaCard = activeSceneRole === "cta";
  const activeSceneImage = sceneImageFor(activeScene, item);
  const readinessChecks = readinessChecksFor(item, scenes);
  const qualityScore = Number(design.quality_score ?? Object.values(readinessChecks).filter(Boolean).length * 20);
  const captionsTimeline = Array.isArray(design.captions_timeline) && design.captions_timeline.length
    ? design.captions_timeline
    : scenes.map((scene, index) => ({ start_second: sceneStarts[index] || 0, end_second: (sceneStarts[index] || 0) + (sceneDurations[index] || 0), text: scene.caption || scene.visual || scene.title }));
  const beatMarkers = Array.isArray(design.beat_markers) && design.beat_markers.length ? design.beat_markers : [0, 2, 5, 7.5, 10, 12.5, 14.5];
  const progressPercent = Math.min(100, Math.max(0, (elapsedSeconds / playbackDuration) * 100));
  const seekToScene = (sceneIndex) => {
    const nextPosition = sceneStarts[sceneIndex] || 0;
    const nextElapsed = sceneTimelineDuration ? (nextPosition / sceneTimelineDuration) * playbackDuration : 0;
    setIsPlaying(false);
    setHasEnded(false);
    setElapsedSeconds(Math.min(playbackDuration, nextElapsed));
    setActiveSceneIndex(sceneIndex);
  };
  const togglePlayback = () => {
    if (hasEnded || elapsedSeconds >= playbackDuration) {
      setElapsedSeconds(0);
      setActiveSceneIndex(0);
      setHasEnded(false);
      setIsPlaying(true);
      return;
    }
    setIsPlaying((playing) => !playing);
  };
  const replay = () => {
    setElapsedSeconds(0);
    setActiveSceneIndex(0);
    setHasEnded(false);
    setIsPlaying(true);
  };
  const sceneFillPercent = (sceneIndex) => {
    const start = sceneStarts[sceneIndex] || 0;
    const end = start + (sceneDurations[sceneIndex] || 0);
    if (sceneTimelinePosition >= end) return 100;
    if (sceneTimelinePosition <= start) return 0;
    return Math.min(100, Math.max(0, ((sceneTimelinePosition - start) / Math.max(0.5, end - start)) * 100));
  };

  useEffect(() => {
    setElapsedSeconds(0);
    setActiveSceneIndex(0);
    setIsPlaying(false);
    setHasEnded(false);
  }, [item.id]);

  useEffect(() => {
    const nextSceneIndex = scenes.findIndex((_, index) => {
      const start = sceneStarts[index] || 0;
      const end = start + (sceneDurations[index] || 0);
      return sceneTimelinePosition >= start && sceneTimelinePosition < end;
    });
    if (nextSceneIndex >= 0) {
      setActiveSceneIndex(nextSceneIndex);
    } else if (scenes.length && sceneTimelinePosition >= sceneTimelineDuration) {
      setActiveSceneIndex(scenes.length - 1);
    }
  }, [sceneDurations, sceneStarts, sceneTimelineDuration, sceneTimelinePosition, scenes]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    const interval = window.setInterval(() => {
      setElapsedSeconds((currentElapsed) => {
        const nextElapsed = Math.min(playbackDuration, currentElapsed + 0.08);
        if (nextElapsed >= playbackDuration) {
          setIsPlaying(false);
          setHasEnded(true);
        }
        return nextElapsed;
      });
    }, 80);
    return () => window.clearInterval(interval);
  }, [isPlaying, playbackDuration]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
      <div className="grid max-h-[92vh] w-full max-w-6xl gap-5 overflow-y-auto rounded-[28px] border border-white/10 bg-[#090d17] p-5 shadow-2xl lg:grid-cols-[minmax(0,520px)_minmax(300px,1fr)]">
        <div className="mx-auto w-full max-w-[360px]">
          <div className={`relative aspect-[9/16] overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl shadow-black/40 ${ activeSceneRole === "price" ? "bg-gradient-to-br from-slate-950 via-amber-950/40 to-black" : activeSceneRole === "urgency" ? "bg-gradient-to-br from-rose-950/60 via-slate-950 to-black" : activeSceneRole === "cta" ? "bg-gradient-to-br from-primary/40 via-slate-950 to-black" : activeSceneRole === "detail" ? "bg-gradient-to-br from-zinc-950 via-slate-900 to-black" : "bg-gradient-to-br from-slate-950 via-slate-900 to-black" }`}>
            {activeSceneImage ? <img src={activeSceneImage} alt="" className={`absolute inset-0 h-full w-full object-cover opacity-25 blur-2xl transition duration-700 ${isPlaying ? "scale-125" : "scale-110"}`} /> : null}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_45%_24%,rgba(34,211,238,.22),transparent_32%),radial-gradient(circle_at_82%_70%,rgba(251,191,36,.13),transparent_28%),linear-gradient(135deg,rgba(255,255,255,.08),transparent_42%,rgba(14,165,233,.1))] animate-pulse" />
            <div className="absolute -left-1/3 top-0 h-full w-1/2 rotate-12 bg-white/10 blur-2xl animate-[pulse_2.8s_ease-in-out_infinite]" />
            <div className="absolute inset-0 opacity-[0.08] [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:6px_6px]" />
            <div className={`absolute inset-0 z-10 bg-white transition-opacity duration-150 ${(activeScene.transition?.includes("flash") || activeScene.transition?.includes("cut")) && isPlaying ? "opacity-20 animate-pulse" : "opacity-0"}`} />
            <div className="absolute inset-x-4 top-3 z-30 flex gap-1.5">
              {scenes.map((scene, sceneIndex) => (
                <div key={scene.id || sceneIndex} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                  <div className="h-full rounded-full bg-white transition-[width] duration-100" style={{ width: `${sceneFillPercent(sceneIndex)}%` }} />
                </div>
              ))}
            </div>
            {showHookText ? (
              <div className="absolute inset-x-5 top-[18%] z-30 text-center transition-all duration-500 opacity-100 translate-y-0 scale-110">
                <div className={`font-black leading-none text-white drop-shadow-[0_14px_28px_rgba(0,0,0,.65)] text-[2.8rem] ${isPlaying ? "animate-pulse" : ""}`}>{hookText}</div>
              </div>
            ) : null}
            <div className={`absolute inset-x-0 z-10 flex items-center justify-center transition-all duration-700 ${ activeSceneRole === "detail" ? "top-[13%] h-[54%]" : activeSceneRole === "price" ? "top-[23%] h-[35%]" : activeSceneRole === "cta" ? "top-[18%] h-[42%]" : "top-[18%] h-[40%]" }`}>
              <div className="absolute h-56 w-56 rounded-full bg-primary/12 blur-3xl animate-pulse" />
              <div className="absolute h-72 w-72 rounded-full bg-white/6 blur-[80px]" />
              <div className="absolute bottom-4 h-8 w-52 rounded-[50%] bg-black/50 blur-xl" />
              {activeSceneImage ? (
                <img
                  src={activeSceneImage}
                  alt=""
                  className={`relative z-10 max-h-full max-w-[86%] object-contain drop-shadow-[0_34px_30px_rgba(0,0,0,.66)] transition duration-700 ${ activeSceneRole === "product" ? "scale-125 -translate-x-4 rotate-[-2deg]" : activeSceneRole === "detail" ? "scale-150 translate-x-8 -translate-y-2 rotate-2" : activeSceneRole === "price" ? "scale-95 translate-x-5 blur-[1px]" : activeSceneRole === "urgency" ? "scale-115 -translate-x-8 rotate-1" : activeSceneRole === "cta" ? "scale-110 translate-y-3" : "scale-125" }`}
                />
              ) : null}
            </div>
            <div className="absolute inset-0 z-20 grid place-items-center">
              <button
                type="button"
                onClick={togglePlayback}
                className={`grid h-16 w-16 place-items-center rounded-full border border-white/20 bg-white/12 text-white shadow-2xl shadow-primary/30 backdrop-blur-md transition hover:scale-105 ${isPlaying ? "opacity-30 hover:opacity-90" : "opacity-100"}`}
                aria-label={isPlaying ? "Pause reel preview" : hasEnded ? "Replay reel preview" : "Play reel preview"}
              >
                {isPlaying ? <Pause className="h-7 w-7 fill-white" /> : <Play className="ml-1 h-7 w-7 fill-white" />}
              </button>
            </div>
            {showProductTitle ? (
              <div className="absolute inset-x-5 bottom-8 z-30 text-white">
                <div className="line-clamp-2 text-2xl font-black leading-tight drop-shadow-[0_12px_28px_rgba(0,0,0,.7)]">{productTitle}</div>
              </div>
            ) : null}
            {showDetailCard ? (
            <div className="absolute left-5 right-5 bottom-[41%] z-30 transition-all duration-500 translate-x-0 opacity-100">
              <div className="rounded-2xl border border-white/10 bg-black/35 p-3 shadow-2xl shadow-black/30 backdrop-blur-md">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-primary">Variant details</div>
                <div className="mt-1 line-clamp-2 text-sm font-black text-white">{sceneCaption || design.color_name || "Available variants"}</div>
              </div>
            </div>
            ) : null}
            {showPriceCard ? (
            <div className="absolute inset-x-5 bottom-[26%] z-30 transition-all duration-500 scale-110 opacity-100">
              <div className="rounded-2xl border border-white/10 bg-black/32 p-3 shadow-2xl shadow-black/30 backdrop-blur-md">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-black uppercase tracking-[0.12em] text-white/55">Price focus</div>
                    {design.price ? <div className="mt-1 text-2xl font-black text-white animate-pulse">{design.price} {design.currency || "EGP"}</div> : null}
                  </div>
                </div>
              </div>
            </div>
            ) : null}
            {showUrgencyCard ? (
            <div className="absolute inset-x-5 bottom-[22%] z-30 transition-all duration-500 translate-y-0 opacity-100">
              <div className="rounded-2xl border border-amber-200/20 bg-amber-300/12 p-3 text-center shadow-2xl shadow-black/30 backdrop-blur-md">
                <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-100">Limited availability</div>
                <div className="mt-1 text-lg font-black text-white">{sceneCaption || "Available now"}</div>
              </div>
            </div>
            ) : null}
            {showCtaCard ? (
            <div className="absolute inset-x-5 bottom-5 z-30 text-white">
              <div className="line-clamp-2 text-xl font-black leading-tight">{productTitle}</div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="inline-flex rounded-full bg-primary px-4 py-2 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(103,232,249,.24)] transition duration-500 scale-110 opacity-100 animate-pulse">{activeScene.caption || design.cta_text || "View details"}</div>
              </div>
            </div>
            ) : null}
            {hasEnded ? (
              <div className="absolute inset-x-5 bottom-[18%] z-40 flex justify-center">
                <button type="button" onClick={replay} className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/45 px-4 py-2 text-xs font-black text-white shadow-2xl backdrop-blur-md transition hover:bg-white/12">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Replay
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="m1-section-title">Video preview</h2>
              <p className="mt-2 text-sm font-semibold text-slate-400">عنصر طابور فيديو جاهز للمعاينة. سيُضاف لاحقًا إنشاء MP4 ونشر Reels.</p>
            </div>
            <button type="button" onClick={onClose} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
          <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
            <Info label="Status" value={String(item.publish_status || item.status || "pending").replaceAll("_", " ")} />
            <Info label="Scheduled" value={scheduledLabel(item)} />
            <Info label="Playback" value={`${elapsedSeconds.toFixed(1)}s / ${playbackDuration}s (${Math.round(progressPercent)}%)`} />
            <Info label="Preset" value={preset} />
            <Info label="Quality score" value={`${qualityScore}/100`} />
            <Info label="Aspect ratio" value={design.aspect_ratio || "9:16"} />
            <Info label="Estimated engagement" value={design.estimated_engagement || "Medium-high"} />
            <Info label="Motion style" value={motionStyle} />
            <Info label="Reel energy" value={design.reel_energy || "premium upbeat"} />
            <Info label="Hook strength" value={`${design.hook_strength || 84}/100`} />
            <Info label="Pacing" value={`${design.pacing_score || 86}/100`} />
            <Info label="CTA strength" value={`${design.cta_strength || 78}/100`} />
            <Info label="Trend fit" value={`${design.trend_fit_score || 84}/100`} />
            <Info label="Reel type" value={reelType} />
            <Info label="Transition style" value={transitionStyle} />
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-white">Video readiness</div>
              <Badge tone={qualityScore >= 80 ? "emerald" : "amber"}>{qualityScore}/100</Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {[
                ["Uses multiple images", readinessChecks.uses_multiple_images],
                ["Has hook", readinessChecks.has_hook],
                ["Has CTA", readinessChecks.has_cta],
                ["Has price", readinessChecks.has_price],
                ["Has audio suggestion", readinessChecks.has_audio_suggestion],
              ].map(([label, passed]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] px-3 py-2">
                  <span className="text-xs font-black text-slate-300">{label}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${passed ? "bg-emerald-400/15 text-emerald-100" : "bg-rose-400/15 text-rose-100"}`}>
                    {passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                    {passed ? "yes" : "no"}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-white">خط زمني بأسلوب CapCut</div>
              <Badge tone="cyan">{formatSeconds(playbackDuration)}ثانية / وضع تلقائي</Badge>
            </div>
            <div className="relative mt-4 h-20 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 p-2">
              <div className="absolute inset-x-2 top-2 flex h-8 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04]">
                {scenes.map((scene, sceneIndex) => (
                  <button
                    key={scene.id || sceneIndex}
                    type="button"
                    onClick={() => seekToScene(sceneIndex)}
                    className={`relative min-w-[44px] overflow-hidden border-r border-white/10 px-2 text-left text-[10px] font-black transition ${sceneIndex === activeSceneIndex ? "text-primary" : "text-white/75 hover:text-white"}`}
                    style={{ width: `${Math.max(8, ((sceneDurations[sceneIndex] || 1) / playbackDuration) * 100)}%` }}
                    title={`${scene.title} ${formatSeconds(sceneStarts[sceneIndex] || 0)}s-${formatSeconds((sceneStarts[sceneIndex] || 0) + (sceneDurations[sceneIndex] || 0))}s`}
                  >
                    {sceneImageFor(scene, item) ? <img src={sceneImageFor(scene, item)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-55" /> : null}
                    <span className={`absolute inset-0 ${sceneIndex === activeSceneIndex ? "bg-primary/35 ring-1 ring-inset ring-primary/50" : "bg-black/45"}`} />
                    <span className="relative z-10">{sceneIndex + 1}</span>
                  </button>
                ))}
              </div>
              <div className="absolute inset-x-2 bottom-3 flex h-7 items-end gap-1">
                {Array.from({ length: 32 }).map((_, index) => (
                  <span
                    key={index}
                    className={`w-1 flex-1 rounded-full ${index / 32 <= progressPercent / 100 ? "bg-primary/80" : "bg-white/15"}`}
                    style={{ height: `${22 + ((index * 19) % 64)}%` }}
                  />
                ))}
              </div>
              {beatMarkers.map((beat, index) => (
                <span key={`${beat}-${index}`} className="absolute bottom-2 h-12 w-px bg-amber-200/60" style={{ left: `${Math.min(98, Math.max(2, (Number(beat) / playbackDuration) * 100))}%` }} />
              ))}
              <span className="absolute bottom-1 top-1 w-0.5 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,.85)] transition-[left] duration-100" style={{ left: `${Math.min(99, Math.max(1, progressPercent))}%` }} />
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-black text-white">الخط الزمني للمشاهد</div>
              <Badge tone="cyan">{isPlaying ? "قيد التشغيل" : hasEnded ? "انتهى" : "انقر للتنقل"}</Badge>
            </div>
            <div className="mt-3 grid gap-2">
              {scenes.map((scene, sceneIndex) => (
                <button
                  key={scene.id || sceneIndex}
                  type="button"
                  onClick={() => seekToScene(sceneIndex)}
                  className={`rounded-[var(--radius-control)] border p-3 text-left transition ${sceneIndex === activeSceneIndex ? "border-primary/50 bg-primary/10" : "border-white/10 bg-white/[0.04] hover:border-white/25"}`}
                >
                  <div className="grid grid-cols-[46px_minmax(0,1fr)] gap-3">
                    <div className="aspect-[9/16] overflow-hidden rounded-lg border border-white/10 bg-slate-950">
                      {sceneImageFor(scene, item) ? <img src={sceneImageFor(scene, item)} alt="" className="h-full w-full object-cover" /> : <Film className="m-3 h-5 w-5 text-slate-500" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-black uppercase tracking-[0.12em] text-primary">{scene.label || `مشهد ${sceneIndex + 1}`}</div>
                        <div className="text-[11px] font-black text-slate-400">{formatSeconds(sceneStarts[sceneIndex] || 0)}s - {formatSeconds((sceneStarts[sceneIndex] || 0) + (sceneDurations[sceneIndex] || 0))}s</div>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full rounded-full bg-primary transition-[width] duration-100" style={{ width: `${sceneFillPercent(sceneIndex)}%` }} />
                      </div>
                      <div className="mt-1 truncate text-sm font-black text-white">{scene.title}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-400">{scene.motion || "إشارة حركة"} | {scene.transition || "انتقال"} | {scene.effect || "تأثير"}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">{scene.animation_preset || "إعداد الحركة"}</div>
                        <div className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white/70">{scene.role || "صورة المشهد"}</div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="text-sm font-black text-white">خط زمني للنصوص / التعليقات</div>
            <div className="mt-3 grid gap-2">
              {captionsTimeline.map((caption, index) => (
                <div key={`${caption.start_second}-${index}`} className="grid grid-cols-[70px_minmax(0,1fr)] gap-3 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
                  <div className="text-xs font-black text-primary">{formatSeconds(caption.start_second || 0)}s</div>
                  <div className="text-xs font-semibold leading-5 text-slate-300">{caption.text}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={togglePlayback} className={`${buttonClass} bg-white text-slate-950 hover:bg-primary`}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying ? "إيقاف المعاينة" : hasEnded ? "إعادة تشغيل المعاينة" : "تشغيل المعاينة"}
            </button>
            <button type="button" onClick={replay} className={`${buttonClass} border border-white/10 bg-white/[0.06] text-white`}>
              <RefreshCw className="h-4 w-4" />
              إعادة التشغيل
            </button>
          </div>
          {audio.title ? (
            <div className="mt-5 rounded-2xl border border-primary/15 bg-primary/[0.06] p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-black text-white">
                  <Music2 className="h-4 w-4 text-primary" />
                  صوت مقترح
                </div>
                <Badge tone="cyan">{audio.trend_label || "رائج"}</Badge>
              </div>
              <div className="mt-2 text-sm font-black text-white">{audio.title}</div>
              <div className="mt-1 text-xs font-bold text-slate-400">{audio.platform_hint || "instagram/facebook"}</div>
              <div className="mt-3 flex h-9 items-end gap-1">
                {Array.from({ length: 18 }).map((_, index) => (
                  <span
                    key={index}
                    className="w-1 flex-1 rounded-full bg-primary/70 animate-pulse"
                    style={{ height: `${28 + ((index * 17) % 58)}%`, animationDelay: `${index * 70}ms` }}
                  />
                ))}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-400">{audio.search_query || audio.mood || ""}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="inline-flex rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-primary">{audio.mood || "energetic"}</div>
                <div className="inline-flex rounded-full border border-amber-200/20 bg-amber-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-amber-100">{audio.trend_label || "رائج"}</div>
              </div>
            </div>
          ) : null}
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="text-sm font-black text-white">النص / التعليق المُولّد</div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{design.script || item.caption || "سيظهر النص هنا بعد الإنشاء."}</div>
          </div>
          <details className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4">
            <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.14em] text-slate-400">تشخيص تقني</summary>
            <pre className="mt-3 max-h-72 overflow-auto text-xs text-slate-300">{JSON.stringify(design, null, 2)}</pre>
          </details>
          <div className="mt-5 flex flex-wrap gap-2">
            {showPublished ? <Badge tone="emerald">منشور</Badge> : null}
            {showPublished && postUrl ? <a href={postUrl} target="_blank" rel="noreferrer" className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>عرض المنشور</a> : null}
            {showApprove ? (
              <button type="button" onClick={onApprove} className={`${buttonClass} border border-emerald-300/20 bg-emerald-400/10 text-emerald-100`}>
                <Check className="h-4 w-4" />
                موافقة
              </button>
            ) : null}
            {showPublish ? (
              <button type="button" onClick={onPublish} className={`${buttonClass} border border-primary/20 bg-primary/10 text-primary`}>
                <Send className="h-4 w-4" />
                نشر
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-black text-white">{value || "غير متاح"}</div>
    </div>
  );
}
