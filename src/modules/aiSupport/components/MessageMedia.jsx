/**
 * Attachment rendering for the AI Inbox transcript.
 *
 * The bubbles used to hand every attachment to the browser and hope: an image was
 * a bare <img> inside a link, a voice note was the native <audio> widget (a light
 * grey pill that reads as a foreign object on a dark transcript, with no duration
 * until it is played), and a document was the word "ملف" above a button reading
 * "فتح الملف" — the name, type and size the webhook already stores were all
 * dropped on the floor.
 *
 * So media is rendered here as first-class chat content: a seekable waveform
 * player for voice, a tiled gallery with an in-app viewer for images, and a file
 * card that names what it is. Everything reads off one classifier, so a WhatsApp
 * attachment that arrives with only a mime type is no longer mistaken for a photo.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Download, ExternalLink, FileArchive, FileSpreadsheet, FileText, ImageOff, Mic, Paperclip, Pause, Play, X, ZoomIn } from "lucide-react";

const asArray = (value) => (Array.isArray(value) ? value : []);
const clean = (value = "") => String(value || "").trim();
const MAX_ITEMS_PER_KIND = 4;

/* ── Classification ──────────────────────────────────────────────────────── */

const AUDIO_TYPES = ["audio", "voice", "ptt", "voice_note"];
const VIDEO_TYPES = ["video"];
const DOCUMENT_TYPES = ["document", "file"];

const rawAttachmentType = (attachment = {}) =>
  clean(attachment.type || attachment.media_type || attachment.message_type || attachment.metadata?.media_type || "").toLowerCase();

const attachmentMime = (attachment = {}) =>
  clean(attachment.mime_type || attachment.mimeType || attachment.metadata?.mime_type || attachment.metadata?.mimeType || "").toLowerCase();

// One kind per attachment. The old filters tested the declared type against a
// list and treated "not audio/video/document" as an image, so an attachment
// carrying only `mime_type: audio/ogg` was rendered as a broken <img>.
const attachmentKind = (attachment = {}) => {
  const type = rawAttachmentType(attachment);
  const mime = attachmentMime(attachment) || (type.includes("/") ? type : "");
  if (AUDIO_TYPES.includes(type) || mime.startsWith("audio/")) return "audio";
  if (VIDEO_TYPES.includes(type) || mime.startsWith("video/")) return "video";
  if (DOCUMENT_TYPES.includes(type) || mime.startsWith("application/") || mime.startsWith("text/")) return "document";
  return "image";
};

const attachmentUrl = (attachment = {}) => clean(
  attachment.url ||
    attachment.image_url ||
    attachment.media_url ||
    attachment.attachment_url ||
    attachment.file_url ||
    attachment.link ||
    attachment.payload?.url ||
    attachment.payload?.image_url ||
    attachment.media?.url ||
    attachment.media?.image?.src ||
    attachment.metadata?.url ||
    attachment.metadata?.media_url ||
    attachment.metadata?.image_url ||
    ""
);

const attachmentFileName = (attachment = {}) => clean(
  attachment.file_name ||
    attachment.fileName ||
    attachment.filename ||
    attachment.name ||
    attachment.title ||
    attachment.metadata?.file_name ||
    attachment.metadata?.fileName ||
    ""
);

const attachmentDuration = (attachment = {}) => {
  const value = Number(
    attachment.duration_seconds ??
      attachment.durationSeconds ??
      attachment.duration ??
      attachment.seconds ??
      attachment.metadata?.duration_seconds ??
      attachment.metadata?.duration ??
      0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const attachmentSize = (attachment = {}) => {
  const value = Number(
    attachment.file_size ?? attachment.fileSize ?? attachment.size ?? attachment.file_length ?? attachment.metadata?.file_size ?? 0
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
};

const messageAttachments = (message = {}) => [
  ...asArray(message.visual_attachments),
  ...asArray(message.visualAttachments),
  ...asArray(message.attachments),
  ...asArray(message.metadata?.visual_attachments),
  ...asArray(message.metadata?.attachments),
  ...asArray(message.channel_metadata?.visual_attachments),
  ...asArray(message.channel_metadata?.attachments),
];

// The message row itself carries loose media columns that predate the attachment
// array, so they are folded in as synthetic attachments rather than handled by a
// second code path that has to be kept in step with this one.
const looseMessageMedia = (message = {}) => {
  const declared = clean(message.message_type).toLowerCase();
  const shared = {
    type: [...AUDIO_TYPES, ...VIDEO_TYPES, ...DOCUMENT_TYPES].includes(declared) ? declared : "",
    mime_type: clean(message.mime_type || message.media_mime_type || ""),
    file_name: clean(message.file_name || message.fileName || ""),
    duration_seconds: attachmentDuration(message),
  };
  return [
    { ...shared, type: shared.type || "image", url: message.image_url },
    { ...shared, url: message.media_url },
    { ...shared, url: message.attachment_url },
    { ...shared, url: message.file_url },
    { ...shared, type: shared.type || "image", url: message.preview_url },
    { ...shared, type: shared.type || "image", url: message.thumbnail_url },
  ];
};

/**
 * Every attachment on a message, split by kind and de-duplicated by URL.
 * One pass, one classifier — all four bubble kinds read the same object.
 */
export const messageMediaGroups = (message = {}) => {
  const groups = { images: [], audios: [], videos: [], documents: [] };
  const seen = new Set();
  for (const attachment of [...looseMessageMedia(message), ...messageAttachments(message)]) {
    const url = attachmentUrl(attachment);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const kind = attachmentKind(attachment);
    const bucket = { image: groups.images, audio: groups.audios, video: groups.videos, document: groups.documents }[kind];
    if (!bucket || bucket.length >= MAX_ITEMS_PER_KIND) continue;
    bucket.push({
      url,
      kind,
      fileName: attachmentFileName(attachment),
      mimeType: attachmentMime(attachment),
      durationSeconds: attachmentDuration(attachment),
      size: attachmentSize(attachment),
    });
  }
  return groups;
};

export const hasMedia = (groups = {}) =>
  Boolean(groups.images?.length || groups.audios?.length || groups.videos?.length || groups.documents?.length);

/* ── Presentation ────────────────────────────────────────────────────────── */

// One tone per bubble kind, so an attachment belongs to the bubble it sits in
// instead of the single slate-950 card that used to sit on all four.
const TONES = {
  customer: {
    shell: "border-white/12 bg-black/25",
    accent: "bg-white text-slate-900 hover:bg-white",
    wave: "bg-white",
    waveIdle: "bg-white/40",
    title: "text-white",
    muted: "text-slate-400",
    chip: "border-white/12 bg-white/[0.07] text-slate-200 hover:bg-white/[0.12]",
    frame: "border-white/12 bg-black/30",
  },
  ai: {
    shell: "border-cyan-300/25 bg-cyan-950/40",
    accent: "bg-cyan-300 text-slate-950 hover:bg-cyan-200",
    wave: "bg-cyan-200",
    waveIdle: "bg-cyan-200/45",
    title: "text-white",
    muted: "text-cyan-200/70",
    chip: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100 hover:bg-cyan-300/20",
    frame: "border-cyan-300/20 bg-cyan-950/40",
  },
  staff: {
    shell: "border-emerald-300/25 bg-emerald-950/40",
    accent: "bg-emerald-300 text-emerald-950 hover:bg-emerald-200",
    wave: "bg-emerald-200",
    waveIdle: "bg-emerald-200/45",
    title: "text-white",
    muted: "text-emerald-200/70",
    chip: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/20",
    frame: "border-emerald-300/20 bg-emerald-950/40",
  },
  comment: {
    shell: "border-amber-300/25 bg-amber-950/40",
    accent: "bg-amber-300 text-amber-950 hover:bg-amber-200",
    wave: "bg-amber-200",
    waveIdle: "bg-amber-200/45",
    title: "text-white",
    muted: "text-amber-200/70",
    chip: "border-amber-300/25 bg-amber-300/10 text-amber-100 hover:bg-amber-300/20",
    frame: "border-amber-300/20 bg-amber-950/40",
  },
  light: {
    shell: "border-slate-200 bg-white",
    accent: "bg-emerald-500 text-white hover:bg-emerald-600",
    // Light mode separates played from unplayed by luminance, not hue: a mid-green
    // against a mid-grey measured 1.06:1 — the progress position was invisible.
    wave: "bg-emerald-700",
    waveIdle: "bg-slate-300",
    title: "text-slate-900",
    muted: "text-slate-500",
    chip: "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100",
    frame: "border-slate-200 bg-slate-50",
  },
};

const toneOf = (tone) => TONES[tone] || TONES.customer;

const formatClock = (seconds = 0) => {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
};

const formatBytes = (value = 0) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
};

/* ── Voice notes ─────────────────────────────────────────────────────────── */

const WAVE_BARS = 42;
const PLAYBACK_RATES = [1, 1.5, 2];

// A stable pseudo-waveform per URL. Decoding the real audio would mean fetching
// and decoding every clip in the transcript on mount; what the bars are actually
// for is a seek target and a progress read-out, and a shape that stays put
// between renders reads as this clip rather than as a generic widget.
const waveformFor = (seed = "") => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Array.from({ length: WAVE_BARS }, (unused, index) => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash ^= hash >>> 13;
    const unit = ((hash >>> 0) % 1000) / 1000;
    const envelope = Math.sin((Math.PI * (index + 1)) / (WAVE_BARS + 1)) ** 0.4;
    return Math.max(0.16, Math.min(1, (0.2 + unit * 0.8) * envelope));
  });
};

// Two clips playing over each other is never what tapping the second one meant,
// so the transcript keeps a single active element.
let activeVoiceAudio = null;

function VoiceNote({ item, tone = "customer", variant = "desktop", transcript = "" }) {
  const { t } = useTranslation();
  const palette = toneOf(tone);
  const audioRef = useRef(null);
  const trackRef = useRef(null);
  const probedRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [metaDuration, setMetaDuration] = useState(0);
  const [rateIndex, setRateIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const bars = useMemo(() => waveformFor(item.url), [item.url]);
  const duration = metaDuration || item.durationSeconds || 0;
  const progress = duration ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const compact = variant === "pwa";

  useEffect(() => {
    const audio = audioRef.current;
    probedRef.current = false;
    setPlaying(false);
    setCurrentTime(0);
    setMetaDuration(0);
    setFailed(false);
    return () => {
      if (activeVoiceAudio === audio) activeVoiceAudio = null;
      audio?.pause();
    };
  }, [item.url]);

  // WhatsApp voice notes arrive as streamed ogg/opus, which Chrome reports with
  // an Infinity duration until it has seen the end of the file. Without the seek
  // probe the player shows "0:00" for every customer voice note ever recorded.
  const readDuration = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      setMetaDuration(audio.duration);
      return;
    }
    if (probedRef.current || item.durationSeconds) return;
    probedRef.current = true;
    const settle = () => {
      audio.removeEventListener("timeupdate", settle);
      if (Number.isFinite(audio.duration) && audio.duration > 0) setMetaDuration(audio.duration);
      try {
        audio.currentTime = 0;
      } catch {
        // Seeking back is best effort; playback still starts wherever it can.
      }
    };
    audio.addEventListener("timeupdate", settle);
    try {
      audio.currentTime = 1e101;
    } catch {
      audio.removeEventListener("timeupdate", settle);
    }
  }, [item.durationSeconds]);

  // A fresh element starts at 1x, so the chosen rate is re-applied from state
  // rather than written once at the click that chose it.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = PLAYBACK_RATES[rateIndex];
  }, [rateIndex, item.url]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (audio.paused) {
      if (activeVoiceAudio && activeVoiceAudio !== audio) activeVoiceAudio.pause();
      activeVoiceAudio = audio;
      audio.playbackRate = PLAYBACK_RATES[rateIndex];
      audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  };

  const cycleRate = () => setRateIndex((current) => (current + 1) % PLAYBACK_RATES.length);

  // The card is pinned to LTR (see the container below), so the visual left edge
  // is always time zero and the ratio needs no direction test.
  const seekTo = (clientX) => {
    const audio = audioRef.current;
    const bounds = trackRef.current?.getBoundingClientRect();
    if (!audio || !bounds?.width || !duration) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  return (
    <div
      dir="ltr"
      className={`flex ${compact ? "min-w-[212px] max-w-[286px]" : "min-w-[268px] max-w-[340px]"} flex-col gap-1.5 rounded-2xl border p-2.5 ${palette.shell}`}
    >
      <audio
        ref={audioRef}
        src={item.url}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={readDuration}
        onDurationChange={readDuration}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => setFailed(true)}
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlayback}
          disabled={failed}
          aria-label={playing ? t("aiSupport.inbox.message.pauseVoice") : t("aiSupport.inbox.message.playVoice")}
          className={`grid ${compact ? "h-9 w-9" : "h-10 w-10"} shrink-0 place-items-center rounded-full shadow-sm transition active:scale-95 disabled:opacity-40 ${palette.accent}`}
        >
          {playing
            ? <Pause className={`${compact ? "h-4 w-4" : "h-[18px] w-[18px]"} fill-current`} />
            : <Play className={`${compact ? "h-4 w-4" : "h-[18px] w-[18px]"} translate-x-[1px] fill-current`} />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <button
            ref={trackRef}
            type="button"
            aria-label={t("aiSupport.inbox.message.seekVoice")}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              seekTo(event.clientX);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) seekTo(event.clientX);
            }}
            className={`flex ${compact ? "h-7" : "h-8"} w-full min-w-0 cursor-pointer touch-none items-center gap-[2px]`}
          >
            {bars.map((height, index) => (
              <span
                key={`${item.url}-bar-${index}`}
                aria-hidden="true"
                style={{ height: `${Math.round(height * (compact ? 22 : 26))}px` }}
                className={`min-w-[2px] flex-1 rounded-full transition-colors duration-150 ${index / (WAVE_BARS - 1) <= progress ? palette.wave : palette.waveIdle}`}
              />
            ))}
          </button>
          <div className={`flex items-center justify-between text-[10px] font-black tabular-nums ${palette.muted}`}>
            <span className="inline-flex items-center gap-1">
              <Mic className="h-3 w-3" />
              {formatClock(currentTime)}
            </span>
            <span>{duration ? formatClock(duration) : "--:--"}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-1">
          <button
            type="button"
            onClick={cycleRate}
            aria-label={t("aiSupport.inbox.message.playbackSpeed")}
            className={`h-6 rounded-lg border px-1.5 text-[10px] font-black tabular-nums transition ${palette.chip}`}
          >
            {PLAYBACK_RATES[rateIndex]}x
          </button>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            download
            aria-label={t("aiSupport.inbox.message.download")}
            className={`grid h-6 place-items-center rounded-lg border transition ${palette.chip}`}
          >
            <Download className="h-3 w-3" />
          </a>
        </div>
      </div>
      {failed ? <p className="px-1 text-[10px] font-bold text-rose-300">{t("aiSupport.inbox.message.mediaUnavailable")}</p> : null}
      {clean(transcript) ? (
        <p dir="auto" className={`rounded-xl border border-dashed px-2 py-1.5 text-[11px] leading-5 ${palette.chip}`}>
          <span className="font-black">{t("aiSupport.inbox.message.transcribed")}: </span>
          {clean(transcript)}
        </p>
      ) : null}
    </div>
  );
}

/* ── Images ──────────────────────────────────────────────────────────────── */

function ImageLightbox({ items = [], index = 0, onClose, onStep }) {
  const { t } = useTranslation();
  const item = items[index];

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onStep(1);
      if (event.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  if (!item || typeof document === "undefined") return null;

  return createPortal(
    <div
      dir="ltr"
      role="dialog"
      aria-modal="true"
      aria-label={t("aiSupport.inbox.message.attachment")}
      className="fixed inset-0 z-[2147483000] flex flex-col bg-black/90 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="text-xs font-black tabular-nums text-white/70">
          {items.length > 1 ? `${index + 1} / ${items.length}` : t("aiSupport.inbox.message.attachment")}
        </span>
        <div className="flex items-center gap-2">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            download
            aria-label={t("aiSupport.inbox.message.download")}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 transition hover:bg-white/20"
          >
            <Download className="h-4 w-4" />
          </a>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            aria-label={t("aiSupport.inbox.message.openInTab")}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 transition hover:bg-white/20"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("aiSupport.inbox.message.closeViewer")}
            className="grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-white/10 transition hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div
        className="flex min-h-0 flex-1 items-center justify-center px-4 pb-6"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <img
          src={item.url}
          alt={item.fileName || t("aiSupport.inbox.message.attachment")}
          className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
        />
      </div>
      {items.length > 1 ? (
        <>
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label={t("aiSupport.inbox.message.previousImage")}
            className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white transition hover:bg-black/70"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label={t("aiSupport.inbox.message.nextImage")}
            className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white transition hover:bg-black/70"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      ) : null}
    </div>,
    document.body
  );
}

function ImageTile({ item, tone, className = "", fit = "cover", overflow = 0, onOpen }) {
  const { t } = useTranslation();
  const palette = toneOf(tone);
  const [failed, setFailed] = useState(false);

  // Images lost to an expired CDN 404 used to fail silently, which on a bubble
  // whose only content is the photo left an empty rectangle behind.
  if (failed) {
    return (
      <div className={`grid place-items-center gap-1 rounded-2xl border border-dashed p-5 text-center ${palette.frame} ${className}`}>
        <ImageOff className={`h-5 w-5 ${palette.muted}`} />
        <span className={`text-[10px] font-black ${palette.muted}`}>{t("aiSupport.inbox.message.mediaUnavailable")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("aiSupport.inbox.message.openImage")}
      className={`group/tile relative block overflow-hidden rounded-2xl border transition ${palette.frame} ${className}`}
    >
      <img
        src={item.url}
        alt={item.fileName || t("aiSupport.inbox.message.attachment")}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"} transition duration-300 group-hover/tile:scale-[1.03]`}
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent opacity-0 transition group-hover/tile:opacity-100" />
      <span className="pointer-events-none absolute bottom-2 left-2 grid h-7 w-7 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition group-hover/tile:opacity-100">
        <ZoomIn className="h-3.5 w-3.5" />
      </span>
      {overflow > 0 ? (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/55 text-lg font-black text-white backdrop-blur-[2px]">+{overflow}</span>
      ) : null}
    </button>
  );
}

function MessageImages({ items = [], tone = "customer", variant = "desktop" }) {
  const [viewer, setViewer] = useState(-1);
  if (!items.length) return null;

  const compact = variant === "pwa";
  const step = (delta) => setViewer((current) => (current + delta + items.length) % items.length);
  const visible = items.slice(0, 4);
  const overflow = items.length - visible.length;

  return (
    <>
      {visible.length === 1 ? (
        <ImageTile
          item={visible[0]}
          tone={tone}
          fit="contain"
          onOpen={() => setViewer(0)}
          className={`${compact ? "max-h-[200px] max-w-[214px]" : "max-h-[268px] max-w-[286px]"} w-fit`}
        />
      ) : (
        <div className={`grid grid-cols-2 gap-1.5 ${compact ? "max-w-[214px]" : "max-w-[286px]"}`}>
          {visible.map((item, index) => (
            <ImageTile
              key={item.url}
              item={item}
              tone={tone}
              onOpen={() => setViewer(index)}
              overflow={index === visible.length - 1 ? overflow : 0}
              className={`aspect-square ${visible.length === 3 && index === 0 ? "col-span-2 aspect-[16/10]" : ""}`}
            />
          ))}
        </div>
      )}
      {viewer >= 0 ? <ImageLightbox items={items} index={viewer} onClose={() => setViewer(-1)} onStep={step} /> : null}
    </>
  );
}

/* ── Documents ───────────────────────────────────────────────────────────── */

const FILE_FAMILIES = [
  { match: /(pdf)/i, label: "PDF", Icon: FileText, tile: "border-rose-400/30 bg-rose-500/15 text-rose-200" },
  { match: /(sheet|excel|csv|xlsx?|numbers)/i, label: "XLS", Icon: FileSpreadsheet, tile: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200" },
  { match: /(zip|rar|7z|tar|gzip|compress)/i, label: "ZIP", Icon: FileArchive, tile: "border-amber-400/30 bg-amber-500/15 text-amber-200" },
  { match: /(word|docx?|rtf|opendocument|text|plain)/i, label: "DOC", Icon: FileText, tile: "border-sky-400/30 bg-sky-500/15 text-sky-200" },
];

const DEFAULT_FAMILY = { label: "", Icon: Paperclip, tile: "border-white/15 bg-white/10 text-slate-200" };

const documentFamily = (item = {}) =>
  FILE_FAMILIES.find((family) => family.match.test(`${item.fileName} ${item.mimeType} ${item.url}`)) || DEFAULT_FAMILY;

const documentExtension = (item = {}) => {
  const fromName = clean(item.fileName).split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-z0-9]+$/i.test(fromName)) return fromName.toUpperCase();
  const fromUrl = clean(item.url).split("?")[0].split(".").pop();
  if (fromUrl && fromUrl.length <= 5 && /^[a-z0-9]+$/i.test(fromUrl) && fromUrl.toLowerCase() !== "bin") return fromUrl.toUpperCase();
  return "";
};

function DocumentCard({ item, tone = "customer", variant = "desktop" }) {
  const { t } = useTranslation();
  const palette = toneOf(tone);
  const family = documentFamily(item);
  const { Icon } = family;
  const meta = [documentExtension(item) || family.label, formatBytes(item.size)].filter(Boolean).join(" · ");
  const compact = variant === "pwa";

  // Two actions, two links: the card opens the file (what an agent wants for a PDF
  // the customer just sent), the trailing button saves it. One link doing both is
  // how the old bubble ended up with a download icon that only ever opened a tab.
  return (
    <div
      className={`flex ${compact ? "min-w-[204px] max-w-[286px]" : "min-w-[236px] max-w-[340px]"} items-center gap-2.5 rounded-2xl border p-2.5 ${palette.shell}`}
    >
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        title={t("aiSupport.inbox.message.openFile")}
        className="flex min-w-0 flex-1 items-center gap-2.5 transition hover:brightness-110"
      >
        <span className={`grid ${compact ? "h-10 w-10" : "h-11 w-11"} shrink-0 place-items-center rounded-xl border ${family.tile}`}>
          <Icon className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span dir="auto" className={`truncate text-[13px] font-black ${palette.title}`}>
            {item.fileName || t("aiSupport.inbox.message.file")}
          </span>
          <span className={`truncate text-[10px] font-bold uppercase tracking-[0.08em] ${palette.muted}`}>
            {meta || t("aiSupport.inbox.message.openFile")}
          </span>
        </span>
      </a>
      <a
        href={item.url}
        target="_blank"
        rel="noreferrer"
        download
        aria-label={t("aiSupport.inbox.message.download")}
        title={t("aiSupport.inbox.message.download")}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border transition ${palette.chip}`}
      >
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}

/* ── Videos ──────────────────────────────────────────────────────────────── */

function VideoCard({ item, tone = "customer", variant = "desktop" }) {
  const palette = toneOf(tone);
  return (
    <div className={`overflow-hidden rounded-2xl border ${palette.frame} ${variant === "pwa" ? "max-w-[214px]" : "max-w-[320px]"}`}>
      <video controls preload="metadata" src={item.url} className="block max-h-[280px] w-full bg-black" />
    </div>
  );
}

/* ── Stack ───────────────────────────────────────────────────────────────── */

/**
 * Every attachment on one message, in a fixed order so a mixed message always
 * reads the same way: pictures, then voice, then video, then files.
 */
function MessageMedia({ message = {}, groups, tone = "customer", variant = "desktop", className = "mt-3" }) {
  const resolved = useMemo(() => groups || messageMediaGroups(message), [groups, message]);
  if (!hasMedia(resolved)) return null;
  // A transcribed voice note carries the transcript as the message body, which the
  // bubble drops as duplicate text — it belongs under the waveform that produced it.
  const transcript = message.voice_transcript
    ? clean(message.customer_message || message.message_text || message.text)
    : "";

  return (
    <div className={`${className} flex flex-col items-start gap-2`}>
      <MessageImages items={resolved.images} tone={tone} variant={variant} />
      {resolved.audios.map((item) => (
        <VoiceNote
          key={item.url}
          item={item}
          tone={tone}
          variant={variant}
          transcript={resolved.audios.length === 1 ? transcript : ""}
        />
      ))}
      {resolved.videos.map((item) => (
        <VideoCard key={item.url} item={item} tone={tone} variant={variant} />
      ))}
      {resolved.documents.map((item) => (
        <DocumentCard key={item.url} item={item} tone={tone} variant={variant} />
      ))}
    </div>
  );
}

export default memo(MessageMedia);
