import { useEffect, useMemo, useState } from "react";
import { Pause, Play, Send, Trash2 } from "lucide-react";

const DEFAULT_LEVELS = [8, 12, 18, 10, 22, 14, 26, 16, 12, 20, 24, 11, 17, 9, 23, 15, 12, 19, 27, 13, 9, 21, 16, 10, 24, 14, 18, 8, 15, 25, 12, 19];

const formatDuration = (seconds = 0) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds || 0)));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
};

export default function WhatsAppRecordingBar({
  stream = null,
  seconds = 0,
  paused = false,
  sending = false,
  onDelete,
  onPauseResume,
  onSend,
}) {
  const [levels, setLevels] = useState(DEFAULT_LEVELS);
  const pausedLevels = useMemo(() => levels.map((level) => Math.max(5, Math.round(level * 0.45))), [levels]);

  useEffect(() => {
    if (!stream || paused || typeof window === "undefined") return undefined;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return undefined;

    let frameId = 0;
    let closed = false;
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.72;
    const source = audioContext.createMediaStreamSource(stream);
    const data = new Uint8Array(analyser.frequencyBinCount);
    source.connect(analyser);

    const draw = () => {
      if (closed) return;
      analyser.getByteFrequencyData(data);
      const bucketSize = Math.max(1, Math.floor(data.length / DEFAULT_LEVELS.length));
      const nextLevels = DEFAULT_LEVELS.map((fallback, index) => {
        const start = index * bucketSize;
        const bucket = data.slice(start, start + bucketSize);
        const average = bucket.reduce((sum, value) => sum + value, 0) / Math.max(1, bucket.length);
        return Math.max(4, Math.min(28, Math.round(average / 8) + Math.round(fallback * 0.35)));
      });
      setLevels(nextLevels);
      frameId = window.requestAnimationFrame(draw);
    };

    void audioContext.resume?.();
    frameId = window.requestAnimationFrame(draw);

    return () => {
      closed = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      source.disconnect();
      audioContext.close().catch(() => null);
    };
  }, [paused, stream]);

  const visibleLevels = paused ? pausedLevels : levels;

  return (
    <div className="flex min-h-[54px] w-full items-center gap-2 rounded-[1.5rem] bg-[#111b21] px-1.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.24)]" dir="ltr">
      <button
        type="button"
        onClick={onDelete}
        disabled={sending}
        className="flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-full bg-[#202c33] text-red-300 transition active:scale-95 disabled:opacity-50"
        aria-label="Delete recording"
      >
        <Trash2 className="h-4 w-4" />
      </button>

      <div className="flex h-10 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full bg-[#1f2c33] px-2">
        <button
          type="button"
          onClick={onPauseResume}
          disabled={sending}
          className="flex h-[var(--control-height-sm)] w-8 shrink-0 items-center justify-center rounded-full bg-[#2a3942] text-slate-100 transition active:scale-95 disabled:opacity-50"
          aria-label={paused ? "Resume recording" : "Pause recording"}
        >
          {paused ? <Play className="h-3.5 w-3.5 fill-current ps-0.5" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
        </button>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-[2px] overflow-hidden" aria-hidden="true">
          {visibleLevels.map((height, index) => (
            <span
              key={index}
              className={`min-w-px flex-1 rounded-full transition-[height,background-color] duration-100 ${paused ? "bg-slate-500/70" : "bg-[#00a884]"}`}
              style={{ height: `${height}px` }}
            />
          ))}
        </div>
        <span className={`flex shrink-0 items-center gap-1 text-[11px] font-bold tabular-nums ${paused ? "text-slate-300" : "text-red-300"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-slate-400" : "animate-pulse bg-red-400"}`} />
          {formatDuration(seconds)}
        </span>
      </div>

      <button
        type="button"
        onClick={onSend}
        disabled={sending}
        className="flex h-[var(--control-height-md)] w-10 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-[#062821] transition active:scale-95 disabled:opacity-50"
        aria-label="Send recording"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
