import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pause, Play } from "lucide-react";

import { normalizeAudioDuration } from "../lib/chatAttachments";

const WAVEFORM_BARS = [4, 8, 13, 7, 16, 10, 19, 14, 6, 15, 18, 9, 13, 5, 17, 12, 8, 15, 19, 11, 6, 16, 13, 7, 18, 10, 15, 5, 12, 19, 9, 14, 6, 16, 11, 13, 4, 15, 18, 8, 12, 6, 17, 10, 14, 7, 16, 5];

const SPEEDS = [1, 1.5, 2];
const SPEED_KEY = "m1.chat.voiceSpeed";
const readSpeed = () => {
  try { const value = Number(window.localStorage.getItem(SPEED_KEY)); return SPEEDS.includes(value) ? value : 1; } catch { return 1; }
};
const LISTENED_KEY = "m1.chat.voiceListened";
const readListened = () => { try { return new Set(JSON.parse(window.localStorage.getItem(LISTENED_KEY) || "[]")); } catch { return new Set(); } };
const markListened = (src) => {
  try {
    const set = readListened(); set.add(src);
    window.localStorage.setItem(LISTENED_KEY, JSON.stringify([...set].slice(-400)));
  } catch { /* private mode */ }
};
// Play the next voice note automatically when one ends (WhatsApp does).
const playNextVoiceNote = (current) => {
  const all = [...document.querySelectorAll("[data-voice-note]")];
  const index = all.indexOf(current);
  const next = all[index + 1];
  next?.querySelector?.("[data-voice-play]")?.click?.();
};

const formatDuration = (seconds = 0) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
};

export default function WhatsAppVoiceMessage({
  src,
  outgoing = false,
  label = "",
  timeText = "",
  showChecks = false,
  read = false,
  duration: messageDuration = 0,
  className = "",
}) {
  const { t } = useTranslation();
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const metadataLoadRequestedRef = useRef(false);
  const fallbackDuration = useMemo(() => normalizeAudioDuration(messageDuration), [messageDuration]);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(fallbackDuration);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(readSpeed);
  const [listened, setListened] = useState(() => readListened().has(String(src || "")));
  const rootRef = useRef(null);
  const cycleSpeed = (event) => {
    event.stopPropagation();
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
    setSpeed(next);
    try { window.localStorage.setItem(SPEED_KEY, String(next)); } catch { /* private mode */ }
    if (audioRef.current) audioRef.current.playbackRate = next;
  };
  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);

  const progress = useMemo(() => {
    if (!duration) return 0;
    return Math.min(1, Math.max(0, currentTime / duration));
  }, [currentTime, duration]);

  const syncDuration = useCallback(() => {
    const audio = audioRef.current;
    const nextDuration = normalizeAudioDuration(audio?.duration) || fallbackDuration;
    setDuration(nextDuration);
    return nextDuration;
  }, [fallbackDuration]);

  useEffect(() => {
    const audio = audioRef.current;
    setPlaying(false);
    setCurrentTime(0);
    setDuration(fallbackDuration);
    metadataLoadRequestedRef.current = false;
    if (!audio || !src) return undefined;

    if (audio.readyState >= 1) {
      syncDuration();
    } else {
      try {
        metadataLoadRequestedRef.current = true;
        audio.load();
      } catch {
        // Metadata loading is best-effort; fallback duration stays visible.
      }
    }

    return () => {
      audio.pause();
    };
  }, [fallbackDuration, src, syncDuration]);

  const handleLoadedMetadata = () => {
    const loadedDuration = syncDuration();
    const audio = audioRef.current;
    if (!loadedDuration && audio && audio.readyState < 1 && !metadataLoadRequestedRef.current) {
      try {
        metadataLoadRequestedRef.current = true;
        audio.load();
      } catch {
        // Keep the fallback duration if the browser cannot resolve metadata.
      }
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    setCurrentTime(audio?.currentTime || 0);
  };

  const handlePlaybackStopped = () => {
    setPlaying(false);
    handleTimeUpdate();
  };
  const handleEnded = () => {
    handlePlaybackStopped();
    if (!listened) { setListened(true); markListened(String(src || "")); }
    playNextVoiceNote(rootRef.current);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.playbackRate = speed;
      audio.play().catch(() => setPlaying(false));
      if (!listened) { setListened(true); markListened(String(src || "")); }
    } else {
      audio.pause();
    }
  };

  const seekToWaveformPosition = (event) => {
    const audio = audioRef.current;
    const waveform = waveformRef.current;
    if (!audio || !duration) return;
    const bounds = waveform?.getBoundingClientRect?.();
    if (!bounds?.width) return;
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    audio.currentTime = ratio * duration;
    setCurrentTime(audio.currentTime);
  };

  return (
    <div ref={rootRef} data-voice-note="" className={`flex w-full min-w-0 flex-col ${className}`} dir="ltr">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => setPlaying(true)}
        onPause={handlePlaybackStopped}
        onEnded={handleEnded}
      />
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <button
          type="button"
          data-voice-play=""
          onClick={togglePlayback}
          className={`flex h-[var(--control-height-sm)] w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 bg-[var(--chat-chrome)] ${listened ? "text-[var(--chat-muted)]" : "text-[var(--primary)]"}`}
          aria-label={playing ? t("employeePortal.chrome.pauseVoiceMessage") : t("employeePortal.chrome.playVoiceMessage")}
        >
          {playing ? <Pause className="h-[15px] w-[15px] fill-current" /> : <Play className="h-[15px] w-[15px] fill-current ps-0.5" />}
        </button>
        <button
          ref={waveformRef}
          type="button"
          onClick={seekToWaveformPosition}
          className="flex h-5 min-w-0 flex-1 items-center gap-[2px] overflow-hidden"
          aria-label={label || t("employeePortal.chrome.voiceMessage")}
        >
          {WAVEFORM_BARS.map((height, index) => {
            const active = index <= Math.round(progress * (WAVEFORM_BARS.length - 1));
            return (
              <span
                key={`${height}-${index}`}
                className={`min-w-px flex-1 rounded-full transition-colors ${ active ? outgoing ? "bg-[var(--primary)]" : "bg-[var(--primary)]" : outgoing ? "bg-[var(--chat-tick)]/50" : "bg-[var(--chat-tick)]/50" }`}
                style={{ height: `${height}px` }}
                aria-hidden="true"
              />
            );
          })}
        </button>
        {playing ? (
          <button type="button" onClick={cycleSpeed} className="h-6 shrink-0 rounded-full bg-[var(--chat-input)] px-1.5 text-[10px] font-black tabular-nums text-[var(--chat-text)]" aria-label={`${speed}x`}>{speed}x</button>
        ) : (
          <span className="w-8 shrink-0 text-right text-[10px] font-medium leading-none tabular-nums text-[var(--chat-tick)]">
            {formatDuration(playing ? currentTime : duration)}
          </span>
        )}
      </div>
      {(timeText || showChecks) ? (
        <div className={`mt-0 flex h-3 items-center justify-end gap-px text-[9px] font-medium leading-none ${outgoing ? "text-[var(--chat-tick)]" : "text-[var(--chat-tick)]"}`}>
          {timeText ? <span>{timeText}</span> : null}
          {showChecks ? <CheckCheck className={`h-3 w-3 ${read ? "text-[var(--chat-link)]" : outgoing ? "text-[var(--chat-tick)]" : "text-[var(--chat-tick)]"}`} /> : null}
        </div>
      ) : null}
    </div>
  );
}
