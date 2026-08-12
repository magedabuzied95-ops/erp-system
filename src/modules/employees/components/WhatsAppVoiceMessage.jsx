import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCheck, Pause, Play } from "lucide-react";

import { normalizeAudioDuration } from "../lib/chatAttachments";

const WAVEFORM_BARS = [4, 8, 13, 7, 16, 10, 19, 14, 6, 15, 18, 9, 13, 5, 17, 12, 8, 15, 19, 11, 6, 16, 13, 7, 18, 10, 15, 5, 12, 19, 9, 14, 6, 16, 11, 13, 4, 15, 18, 8, 12, 6, 17, 10, 14, 7, 16, 5];

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

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setPlaying(false));
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
    <div className={`flex w-full min-w-0 flex-col ${className}`} dir="ltr">
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
        onEnded={handlePlaybackStopped}
      />
      <div className="flex h-8 min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={togglePlayback}
          className={`flex h-[var(--control-height-sm)] w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${ outgoing ? "bg-[#d9fdd3] text-[#005c4b]" : "bg-[#e9edef] text-[#202c33]" }`}
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
                className={`min-w-px flex-1 rounded-full transition-colors ${ active ? outgoing ? "bg-[#f0f8f3]" : "bg-[#00a884]" : outgoing ? "bg-[#8fc6b7]/75" : "bg-[#8696a0]/75" }`}
                style={{ height: `${height}px` }}
                aria-hidden="true"
              />
            );
          })}
        </button>
        <span className={`w-8 shrink-0 text-right text-[10px] font-medium leading-none tabular-nums ${outgoing ? "text-[#c6ded8]" : "text-[#aebac1]"}`}>
          {formatDuration(duration)}
        </span>
      </div>
      {(timeText || showChecks) ? (
        <div className={`mt-0 flex h-3 items-center justify-end gap-px text-[9px] font-medium leading-none ${outgoing ? "text-[#c6ded8]" : "text-[#aebac1]"}`}>
          {timeText ? <span>{timeText}</span> : null}
          {showChecks ? <CheckCheck className={`h-3 w-3 ${read ? "text-[#53bdeb]" : outgoing ? "text-[#c6ded8]" : "text-[#aebac1]"}`} /> : null}
        </div>
      ) : null}
    </div>
  );
}
