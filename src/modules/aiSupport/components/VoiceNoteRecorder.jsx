/*
 * Recording a voice note in the composer — shared by /admin/ai-inbox and the
 * /inbox PWA, because a fix applied to one inbox page does not exist on the other.
 *
 * The container is whatever the browser gives us: Chrome records
 * audio/webm;codecs=opus, Safari audio/mp4. Neither is converted here — the
 * server asks WhatsApp to transcode to the Opus/OGG that renders as a playable
 * voice bubble, and a phone CPU is the wrong place to do that work.
 *
 * The microphone track is stopped on every exit path (send, cancel, unmount, an
 * error mid-recording). A live track left open keeps the browser's recording
 * indicator on and, on a phone, holds the mic against every other app.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Mic, Send, Square, Trash2 } from "lucide-react";

import { normalizeVoiceNote } from "../utils/voiceNoteEncoding";

const MIME_CANDIDATES = [
  // mp4/aac first: it is the only container Safari and iOS can play back, and a
  // note nobody in the shop can replay is a note that may as well not be stored.
  // Chrome falls through to webm and the recording is re-encoded before upload.
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
];

export const pickRecorderMimeType = (isSupported) => {
  const supported = typeof isSupported === "function"
    ? isSupported
    : (type) => (typeof window !== "undefined"
      && typeof window.MediaRecorder !== "undefined"
      && typeof window.MediaRecorder.isTypeSupported === "function"
      ? window.MediaRecorder.isTypeSupported(type)
      : false);
  for (const type of MIME_CANDIDATES) {
    if (supported(type)) return type;
  }
  // Safari used to support no explicit type at all; an empty string lets
  // MediaRecorder choose, which is better than refusing to record.
  return "";
};

export const voiceNoteFileName = (mimeType = "", at = new Date()) => {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  const type = String(mimeType || "").toLowerCase();
  const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  return `voice-${stamp}.${extension}`;
};

export const formatRecorderClock = (seconds = 0) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
};

export const voiceRecordingSupported = () =>
  typeof window !== "undefined"
  && typeof window.MediaRecorder !== "undefined"
  && Boolean(navigator?.mediaDevices?.getUserMedia);

/** A recording longer than this is almost always a button left pressed by accident. */
export const MAX_VOICE_NOTE_SECONDS = 300;

function VoiceNoteRecorder({
  disabled = false,
  busy = false,
  tone = "light",
  // On a phone the reply row has no spare width: while recording, the composer
  // hands the whole row over (as WhatsApp does) instead of squeezing the editor
  // into two lines beside a timer.
  expand = false,
  onSend,
  onError,
  onRecordingChange,
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickRef = useRef(null);
  const keepRef = useRef(true);

  const releaseMic = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Unmounting mid-recording (the thread is closed, the page navigates) must not
  // leave the microphone open.
  useEffect(() => () => releaseMic(), [releaseMic]);

  const start = useCallback(async () => {
    if (disabled || busy || recording) return;
    if (!voiceRecordingSupported()) {
      onError?.(t("aiSupport.inbox.composer.voiceUnsupported"));
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no microphone — all the same answer to the operator.
      onError?.(t("aiSupport.inbox.composer.voicePermissionDenied"));
      return;
    }
    const mimeType = pickRecorderMimeType();
    let recorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      onError?.(t("aiSupport.inbox.composer.voiceUnsupported"));
      return;
    }
    keepRef.current = true;
    chunksRef.current = [];
    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const chunks = chunksRef.current;
      const keep = keepRef.current;
      const type = recorder.mimeType || mimeType || "audio/webm";
      releaseMic();
      setRecording(false);
      setSeconds(0);
      onRecordingChange?.(false);
      if (!keep || !chunks.length) return;
      const blob = new Blob(chunks, { type });
      if (!blob.size) return;
      const recorded = new File([blob], voiceNoteFileName(type), { type, lastModified: Date.now() });
      // Re-encoded only when the container cannot be played back on iOS. The
      // promise is never rejected — the original is returned on any failure.
      void normalizeVoiceNote(recorded).then((file) => onSend?.(file || recorded));
    };
    recorder.start();
    setRecording(true);
    setSeconds(0);
    onRecordingChange?.(true);
    tickRef.current = setInterval(() => {
      setSeconds((current) => {
        const next = current + 1;
        // Stopped from inside the tick so a forgotten recording still sends what
        // it captured rather than being thrown away.
        if (next >= MAX_VOICE_NOTE_SECONDS && recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
        }
        return next;
      });
    }, 1000);
  }, [busy, disabled, onError, onRecordingChange, recording, releaseMic, t]);

  const stop = useCallback((keep) => {
    keepRef.current = keep !== false;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseMic();
      setRecording(false);
      setSeconds(0);
      onRecordingChange?.(false);
      return;
    }
    recorder.stop();
  }, [onRecordingChange, releaseMic]);

  const dark = tone === "dark";
  const idleClass = dark
    ? "bg-white/[0.06] text-slate-300 ring-white/10 hover:text-white"
    : "bg-slate-100 text-slate-600 ring-slate-200";

  if (!recording) {
    return (
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || busy}
        className={`inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 transition disabled:opacity-50 ${idleClass}`}
        aria-label={t("aiSupport.inbox.composer.recordVoice")}
        title={t("aiSupport.inbox.composer.recordVoice")}
      >
        <Mic className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-2xl px-2 py-1 ring-1 ${expand ? "min-w-0 flex-1 justify-between" : "shrink-0"} ${dark ? "bg-rose-500/10 ring-rose-400/30" : "bg-rose-50 ring-rose-200"}`}
      role="group"
      aria-label={t("aiSupport.inbox.composer.recordingVoice")}
    >
      <button
        type="button"
        onClick={() => stop(false)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${dark ? "text-slate-300 hover:text-rose-300" : "text-slate-500 hover:text-rose-600"}`}
        aria-label={t("aiSupport.inbox.composer.discardVoice")}
        title={t("aiSupport.inbox.composer.discardVoice")}
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <span className={`inline-flex items-center gap-1.5 text-[12px] font-black tabular-nums ${dark ? "text-rose-200" : "text-rose-700"}`}>
        <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
        {formatRecorderClock(seconds)}
      </span>
      <button
        type="button"
        onClick={() => stop(true)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-rose-600 text-slate-50 transition hover:bg-rose-500"
        aria-label={t("aiSupport.inbox.composer.sendVoice")}
        title={t("aiSupport.inbox.composer.sendVoice")}
      >
        {busy ? <Square className="h-4 w-4" /> : <Send className="h-4 w-4" />}
      </button>
    </div>
  );
}

export default VoiceNoteRecorder;
