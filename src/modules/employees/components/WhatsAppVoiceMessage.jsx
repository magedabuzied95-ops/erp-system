import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCheck, Pause, Play } from "lucide-react";

const WAVEFORM_BARS = [5, 9, 14, 8, 18, 11, 21, 15, 7, 17, 20, 10, 14, 6, 19, 13, 9, 16, 22, 12, 7, 18, 14, 8, 20, 11, 16, 6, 13, 21, 10, 15, 7, 18, 12, 14, 5, 17, 20, 9, 13, 6];

const formatDuration = (seconds = 0) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
};

export default function WhatsAppVoiceMessage({
  src,
  outgoing = false,
  label = "Voice message",
  timeText = "",
  showChecks = false,
  read = false,
  className = "",
}) {
  const audioRef = useRef(null);
  const waveformRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const progress = useMemo(() => {
    if (!duration) return 0;
    return Math.min(1, Math.max(0, currentTime / duration));
  }, [currentTime, duration]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const syncDuration = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const syncTime = () => setCurrentTime(audio.currentTime || 0);
    const syncPlaying = () => setPlaying(!audio.paused && !audio.ended);
    const syncStopped = () => {
      setPlaying(false);
      syncTime();
    };

    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("durationchange", syncDuration);
    audio.addEventListener("timeupdate", syncTime);
    audio.addEventListener("play", syncPlaying);
    audio.addEventListener("pause", syncStopped);
    audio.addEventListener("ended", syncStopped);
    syncDuration();
    syncTime();

    return () => {
      audio.removeEventListener("loadedmetadata", syncDuration);
      audio.removeEventListener("durationchange", syncDuration);
      audio.removeEventListener("timeupdate", syncTime);
      audio.removeEventListener("play", syncPlaying);
      audio.removeEventListener("pause", syncStopped);
      audio.removeEventListener("ended", syncStopped);
      audio.pause();
    };
  }, [src]);

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
    <div className={`w-[min(70vw,18rem)] min-w-[12rem] max-w-full ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={togglePlayback}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            outgoing ? "bg-[#d9fdd3] text-[#005c4b]" : "bg-[#e9edef] text-[#202c33]"
          }`}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
        >
          {playing ? <Pause className="h-[15px] w-[15px] fill-current" /> : <Play className="h-[15px] w-[15px] fill-current ps-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <button
            ref={waveformRef}
            type="button"
            onClick={seekToWaveformPosition}
            className="flex h-[21px] min-w-0 items-center gap-[2px] overflow-hidden"
            aria-label={label}
          >
            {WAVEFORM_BARS.map((height, index) => {
              const active = index <= Math.round(progress * (WAVEFORM_BARS.length - 1));
              return (
                <span
                  key={`${height}-${index}`}
                  className={`min-w-[2px] flex-1 rounded-full transition-colors ${
                    active
                      ? outgoing ? "bg-[#f0f8f3]" : "bg-[#00a884]"
                      : outgoing ? "bg-[#8fc6b7]/75" : "bg-[#8696a0]/75"
                  }`}
                  style={{ height: `${height}px` }}
                  aria-hidden="true"
                />
              );
            })}
          </button>
          <div className={`mt-[1px] flex h-3.5 items-center justify-between gap-2 text-[10px] font-medium leading-none ${outgoing ? "text-[#c6ded8]" : "text-[#aebac1]"}`} dir="ltr">
            <span>{formatDuration(duration)}</span>
            <span className="inline-flex shrink-0 items-center gap-0.5">
              {timeText ? <span>{timeText}</span> : null}
              {showChecks ? <CheckCheck className={`h-3.5 w-3.5 ${read ? "text-[#53bdeb]" : outgoing ? "text-[#c6ded8]" : "text-[#aebac1]"}`} /> : null}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
