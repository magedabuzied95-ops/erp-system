import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, History, Loader2, Maximize2, Pause, Play, Search } from "lucide-react";

import { openPlayback, playbackBackend, searchPlayback } from "../services/surveillanceApi";
import DeviceChannelPicker from "../components/DeviceChannelPicker";
import { Failed, PageHeader, Pill, Section } from "../components/SurveillanceUi";
import { frameStyleFor, requestTileFullscreen } from "../lib/displayAspect";
import { playWhep, streamErrorKey } from "../lib/whepClient";
import "../../../theme/ai-surface.css";

/**
 * Recorded footage.
 *
 * NOTHING IS DOWNLOADED
 * ---------------------
 * The search returns metadata only. Selecting a segment opens a bounded RTSP
 * replay through the SAME media gateway as live — a stream, not a file. A day
 * of 2048 kbps footage is roughly 20 GB; a page that downloaded it to scrub
 * through it would be unusable and would fill the operator's disk.
 *
 * THE CLOCK IS THE RECORDER'S, AND IT DRIFTS
 * ------------------------------------------
 * Every time shown here comes from the recorder, whose NTP is disabled. That
 * warning is not a footnote: an investigator matching footage against a till
 * receipt needs to know the two clocks were never synchronised.
 */

const HOUR_MS = 3_600_000;

/** Local `datetime-local` value for an offset from now. */
const localInput = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function SurveillancePlayback() {
  const { t } = useTranslation();
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const sessionRef = useRef(null);

  const [selection, setSelection] = useState({ deviceId: null, channelIndex: null });
  const [backend, setBackend] = useState(null);
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 2 * HOUR_MS)));
  const [to, setTo] = useState(() => localInput(new Date()));
  const [result, setResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorKey, setErrorKey] = useState(null);

  useEffect(() => {
    if (!selection.deviceId) return;
    void playbackBackend(selection.deviceId).then(setBackend).catch(() => setBackend(null));
  }, [selection.deviceId]);

  const stop = useCallback(() => {
    sessionRef.current?.close?.();
    sessionRef.current = null;
    setStatus("idle");
  }, []);

  useEffect(() => stop, [stop]);

  const runSearch = useCallback(async () => {
    if (!selection.deviceId || selection.channelIndex === null) return;
    setSearching(true);
    setFailed(false);
    setResult(null);
    stop();
    try {
      const response = await searchPlayback(selection.deviceId, selection.channelIndex, {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      });
      setResult(response);
    } catch { setFailed(true); }
    setSearching(false);
  }, [selection, from, to, stop]);

  const play = useCallback(async (recording) => {
    stop();
    setStatus("connecting");
    setErrorKey(null);
    setActive(recording);
    try {
      const response = await openPlayback(selection.deviceId, selection.channelIndex, {
        from: recording.startedAt,
        to: recording.endedAt,
        recording_token: recording.recordingToken,
      });
      const stream = response?.stream;
      if (!stream?.playable) {
        setStatus("error");
        setErrorKey("surveillance.live.errorNoGateway");
        return;
      }
      sessionRef.current = await playWhep({
        whepUrl: stream.whep_url,
        ticket: stream.ticket,
        videoElement: videoRef.current,
        onState: (state) => setStatus(state === "connected" ? "playing" : state),
      });
    } catch (error) {
      setStatus("error");
      setErrorKey(streamErrorKey(error));
    }
  }, [selection, stop]);

  const windowMs = useMemo(() => {
    const start = new Date(from).getTime();
    const end = new Date(to).getTime();
    return end > start ? end - start : 0;
  }, [from, to]);

  return (
    <div className="m1-ai-scope space-y-4 p-4 text-white md:p-6">
      <PageHeader
        eyebrowIcon={History}
        title={t("surveillance.playback.title")}
        subtitle={t("surveillance.playback.subtitle")}
        actions={<DeviceChannelPicker value={selection} onChange={setSelection} />}
      />

      {/* Which backend answered, and why — so a fallback is explained rather
          than silently different. */}
      {backend && (
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-400">
          <Pill tone={backend.backend === "onvif" ? "ok" : "neutral"}>
            {t(`surveillance.playback.backend.${backend.backend}`)}
          </Pill>
          {backend.backend !== "onvif" && backend.onvif_state && (
            <span>{t(`surveillance.playback.onvifState.${backend.onvif_state}`, { defaultValue: backend.onvif_state })}</span>
          )}
        </div>
      )}

      <Section title={t("surveillance.playback.window")}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            {t("surveillance.playback.from")}
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
              className="h-[var(--control-height-md)] rounded-lg border border-white/10 bg-white/[0.055] px-2 text-[12px] text-slate-200" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">
            {t("surveillance.playback.to")}
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
              className="h-[var(--control-height-md)] rounded-lg border border-white/10 bg-white/[0.055] px-2 text-[12px] text-slate-200" />
          </label>
          <button type="button" disabled={searching || !selection.deviceId} onClick={() => void runSearch()}
            className="inline-flex h-[var(--control-height-md)] items-center gap-2 rounded-full border border-primary/50 bg-primary/15 px-4 text-[11px] font-black hover:border-primary disabled:opacity-50">
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            {t("surveillance.playback.search")}
          </button>
          {windowMs > 24 * HOUR_MS && (
            <span className="text-[11px] text-amber-300">{t("surveillance.playback.windowTooLong")}</span>
          )}
        </div>
      </Section>

      {result?.clock && result.clock.trusted === false && (
        <div className="flex items-start gap-2 rounded-[var(--radius-card)] border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-[12px] text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("surveillance.playback.clockWarning")}</span>
        </div>
      )}

      {failed && <Failed messageKey="surveillance.playback.searchFailed" />}

      {result && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Section title={t("surveillance.playback.player")}
            right={active ? <Pill tone="info">{new Date(active.startedAt).toLocaleString()}</Pill> : null}>
            <div ref={stageRef} className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
              {/* Same 1080N display correction as live: the recorded stream has
                  the same non-square pixels, and WebRTC discards the SAR. */}
              <div style={frameStyleFor({ width: 960, height: 1080 })} className="relative">
                <video ref={videoRef} autoPlay muted playsInline
                  className="block h-full w-full" style={{ objectFit: "fill", background: "#000" }} />
                {status !== "playing" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-center text-xs text-slate-300">
                    {status === "connecting" && <Loader2 className="h-5 w-5 animate-spin" />}
                    {status === "error" && <AlertTriangle className="h-5 w-5 text-amber-300" />}
                    <span className="px-3">{errorKey ? t(errorKey) : t("surveillance.playback.pickSegment")}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => videoRef.current?.play()}
                    aria-label={t("surveillance.playback.play")}
                    className="rounded p-1 text-slate-300 hover:bg-white/10"><Play className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => videoRef.current?.pause()}
                    aria-label={t("surveillance.playback.pause")}
                    className="rounded p-1 text-slate-300 hover:bg-white/10"><Pause className="h-3.5 w-3.5" /></button>
                </div>
                <button type="button" onClick={() => requestTileFullscreen(stageRef.current)}
                  aria-label={t("surveillance.live.fullscreen")}
                  className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white">
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* The timeline: each segment placed by its real position in the
                requested window, so gaps in recording are visible. */}
            {windowMs > 0 && (
              <div className="mt-3">
                <div className="relative h-6 overflow-hidden rounded bg-white/[0.06]">
                  {(result.recordings || []).map((rec, index) => {
                    const start = new Date(rec.startedAt).getTime();
                    const end = new Date(rec.endedAt || rec.startedAt).getTime();
                    const windowStart = new Date(from).getTime();
                    const left = ((start - windowStart) / windowMs) * 100;
                    const width = Math.max(0.4, ((end - start) / windowMs) * 100);
                    if (!Number.isFinite(left) || !Number.isFinite(width)) return null;
                    return (
                      <button key={rec.recordingToken || index} type="button" onClick={() => void play(rec)}
                        title={new Date(rec.startedAt).toLocaleString()}
                        className={`absolute top-0 h-full ${active === rec ? "bg-primary" : "bg-emerald-400/60 hover:bg-emerald-300"}`}
                        style={{ insetInlineStart: `${Math.max(0, Math.min(100, left))}%`, width: `${Math.min(100, width)}%` }} />
                    );
                  })}
                </div>
                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-600">
                  <span>{new Date(from).toLocaleTimeString()}</span>
                  <span>{new Date(to).toLocaleTimeString()}</span>
                </div>
              </div>
            )}
          </Section>

          <Section title={t("surveillance.playback.segments", { count: (result.recordings || []).length })}>
            {(result.recordings || []).length === 0 ? (
              <p className="text-[12px] text-slate-500">{t("surveillance.playback.noSegments")}</p>
            ) : (
              <ul className="flex max-h-[26rem] flex-col gap-1 overflow-y-auto">
                {result.recordings.map((rec, index) => (
                  <li key={rec.recordingToken || index}>
                    <button type="button" onClick={() => void play(rec)}
                      className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-start text-[12px] hover:bg-white/[0.06] ${
                        active === rec ? "bg-primary/15 text-white" : "text-slate-300"}`}>
                      <span className="tabular-nums">{new Date(rec.startedAt).toLocaleTimeString()}</span>
                      <span className="text-[10px] tabular-nums text-slate-500">
                        {rec.endedAt ? new Date(rec.endedAt).toLocaleTimeString() : "—"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}
