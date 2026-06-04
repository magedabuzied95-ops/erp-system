import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

const WAVEFORM_BARS = [9, 14, 21, 13, 27, 18, 32, 22, 15, 29, 34, 19, 25, 12, 31, 23, 17, 28, 36, 20, 14, 30, 24, 16, 33, 21, 27, 13, 22, 35, 18, 26, 15, 31, 20, 24];

const formatDuration = (seconds = 0) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  return `${minutes}:${String(safeSeconds % 60).padStart(2, "0")}`;
};

export default function WhatsAppVoiceMessage({ src, outgoing = false, label = "Voice message", className = "" }) {
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

  const elapsed = currentTime > 0 ? currentTime : duration;

  return (
    <div className={`mb-1.5 w-[min(64vw,18.5rem)] min-w-[11.5rem] max-w-full ${className}`}>
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={togglePlayback}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition active:scale-95 ${
            outgoing ? "bg-[#d9fdd3] text-[#005c4b]" : "bg-[#e9edef] text-[#202c33]"
          }`}
          aria-label={playing ? "Pause voice message" : "Play voice message"}
        >
          {playing ? <Pause className="h-[18px] w-[18px] fill-current" /> : <Play className="h-[18px] w-[18px] fill-current ps-0.5" />}
        </button>
        <div className="min-w-0 flex-1">
          <button
            ref={waveformRef}
            type="button"
            onClick={seekToWaveformPosition}
            className="flex h-9 min-w-0 items-center gap-[2px] overflow-hidden sm:gap-[3px]"
            aria-label={label}
          >
            {WAVEFORM_BARS.map((height, index) => {
              const active = index <= Math.round(progress * (WAVEFORM_BARS.length - 1));
              return (
                <span
                  key={`${height}-${index}`}
                  className={`min-w-[2px] flex-1 rounded-full transition-colors ${
                    active
                      ? outgoing ? "bg-[#075e54]" : "bg-[#53bdeb]"
                      : outgoing ? "bg-[#6fb7a6]/70" : "bg-[#8696a0]/70"
                  }`}
                  style={{ height: `${height}px` }}
                  aria-hidden="true"
                />
              );
            })}
          </button>
          <div className={`mt-0.5 text-[11px] font-semibold leading-4 ${outgoing ? "text-[#d6f3e7]" : "text-[#aebac1]"}`} dir="ltr">
            {formatDuration(elapsed)}
          </div>
        </div>
      </div>
    </div>
  );
}
