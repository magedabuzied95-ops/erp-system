import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Maximize2, Video, VideoOff } from "lucide-react";

import { closeStream, openStream } from "../services/surveillanceApi";
import { frameStyleFor, requestTileFullscreen } from "../lib/displayAspect";
import { playWhep, streamErrorKey } from "../lib/whepClient";

/**
 * One camera.
 *
 * ON-DEMAND BY CONSTRUCTION
 * -------------------------
 * The stream opens when the tile mounts and closes when it unmounts. Nothing
 * runs for a tile nobody is looking at, which is requirement #32 and also the
 * only reason a 16-tile wall is affordable: the encoder budget is spent on
 * what is on screen, not on what exists.
 *
 * The cleanup is not best-effort. A tile that fails to release leaves an FFmpeg
 * process and an RTSP session against the recorder, and the recorder has a
 * finite number of those.
 */
export default function CameraTile({ channel, tileCount = 1, onCapacityError }) {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const sessionRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [errorKey, setErrorKey] = useState(null);
  const [profile, setProfile] = useState(null);

  const stop = useCallback(() => {
    sessionRef.current?.close?.();
    sessionRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setStatus("connecting");
    setErrorKey(null);
    try {
      // The tile count travels with the request so the server can pick a
      // cheaper profile for a 16-up wall than for a single focused camera.
      const response = await openStream(channel.id, { purpose: tileCount > 1 ? "grid" : "live", tile_count: tileCount });
      const stream = response?.stream;

      if (!stream?.playable) {
        setStatus("unavailable");
        setErrorKey(
          stream?.unavailable_reason === "media-gateway-not-configured"
            ? "surveillance.live.errorNoGateway"
            : "surveillance.live.errorGeneric",
        );
        return;
      }

      setProfile(stream.profile);
      sessionRef.current = await playWhep({
        whepUrl: stream.whep_url,
        ticket: stream.ticket,
        videoElement: videoRef.current,
        onState: (state) => setStatus(state === "connected" ? "live" : state),
      });
    } catch (error) {
      setStatus("error");
      setErrorKey(streamErrorKey(error));
      if (error?.status === 503) onCapacityError?.(error);
    }
  }, [channel.id, tileCount, onCapacityError]);

  useEffect(() => {
    void start();
    return () => {
      stop();
      // Best-effort server-side release. The gateway's own idle timer is the
      // backstop, but a closed tab should not depend on a 30 s timeout to stop
      // dialling a camera.
      void closeStream(channel.id, {}).catch(() => {});
    };
  }, [start, stop, channel.id]);

  const live = status === "live";
  // Geometry comes from the profile the SERVER chose. Hardcoding 16:9 here
  // would draw the 1080N stream as a tall, stretched picture — see displayAspect.
  const frameStyle = frameStyleFor(profile || {});

  return (
    <div
      ref={containerRef}
      className="group relative overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-black"
    >
      <div style={frameStyle} className="relative">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          // `fill` stretches the coded frame into the display-aspect box.
          // `contain` would letterbox at the coded aspect and undo the fix.
          className="block h-full w-full"
          style={{ objectFit: "fill", background: "#000" }}
        />

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-xs text-slate-300">
            {status === "connecting" && <Loader2 className="h-5 w-5 animate-spin" />}
            {(status === "error" || status === "unavailable") && (
              <AlertTriangle className="h-5 w-5 text-amber-300" />
            )}
            <span className="px-3">
              {errorKey ? t(errorKey) : t("surveillance.live.connecting")}
            </span>
            {(status === "error" || status === "unavailable") && (
              <button
                type="button"
                onClick={() => void start()}
                className="mt-1 rounded-full border border-white/20 px-3 py-1 text-[11px] font-black hover:border-white/40"
              >
                {t("surveillance.live.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.04] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {live ? (
            <Video className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
          ) : (
            <VideoOff className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          )}
          <span className="truncate text-[12px] font-bold text-slate-200">{channel.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {profile && (
            <span className="text-[10px] tabular-nums text-slate-500">
              {profile.width}&times;{profile.height} &middot; {profile.fps}fps
            </span>
          )}
          <button
            type="button"
            aria-label={t("surveillance.live.fullscreen")}
            onClick={() => requestTileFullscreen(containerRef.current)}
            className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
