/*
 * Voice search for the storefront search field.
 *
 * Owner report 2026-09-15: on the iPhone, tapping the mic and speaking wrote nothing. The old
 * handler started webkitSpeechRecognition with no onerror and no onend, so every refusal was
 * silent — and iPhone Safari refuses whenever Siri & Dictation is off ("service-not-allowed"),
 * and never runs at all in an installed web app.
 *
 * So there are two engines:
 *  - "native": the browser's recogniser, where it is dependable (Chrome on Android, desktop).
 *    Interim results write into the field as the shopper speaks.
 *  - "recorder": record a short clip and have the server transcribe it (POST
 *    /storefront/voice-search). Used on iOS, anywhere without a recogniser, and as the fallback
 *    when the recogniser refuses. It stops by itself once the shopper stops talking.
 *
 * Every failure ends in a copy key the caller toasts, never in silence. Framework-free apart from
 * browser APIs, so the decisions can be tested with stubs.
 */

const SERVER_STATE_KEY = "storefront.voiceSearch.server";

// Tuned on speech, not music: a quiet room reads ~0.005 RMS, a normal voice 0.03-0.15.
const SPEECH_RMS = 0.02;
const TRAILING_SILENCE_MS = 1300;
const NO_SPEECH_GIVE_UP_MS = 6000;
const MAX_RECORDING_MS = 9000;
const NATIVE_SAFETY_MS = 12000;

export const VOICE_ERROR_KEYS = {
  denied: "storefront.voiceSearch.micDenied",
  noSpeech: "storefront.voiceSearch.noSpeech",
  noMic: "storefront.voiceSearch.noMic",
  failed: "storefront.voiceSearch.failed",
  unsupported: "storefront.toasts.voiceUnsupported",
};

const readServerState = () => {
  try {
    return window.sessionStorage?.getItem(SERVER_STATE_KEY) || "";
  } catch {
    return "";
  }
};
const writeServerState = (value) => {
  try {
    window.sessionStorage?.setItem(SERVER_STATE_KEY, value);
  } catch {
    // Private mode: the next tap simply tries the server again.
  }
};

export const isIosLike = (nav = typeof navigator !== "undefined" ? navigator : {}) => {
  const ua = String(nav.userAgent || "");
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav.maxTouchPoints || 0) > 1);
};

export const pickRecorderMime = (Recorder = typeof MediaRecorder !== "undefined" ? MediaRecorder : null) => {
  if (!Recorder?.isTypeSupported) return "";
  // mp4 first: it is what iOS records, and Groq/OpenAI read it without transcoding.
  return ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) => Recorder.isTypeSupported(type)) || "";
};

/** Which engine a tap should use. */
export const chooseVoiceEngine = ({
  hasRecogniser = false,
  canRecord = false,
  iosLike = false,
  serverState = "",
} = {}) => {
  const serverUsable = canRecord && serverState !== "unavailable";
  if ((iosLike || !hasRecogniser) && serverUsable) return "recorder";
  if (hasRecogniser) return "native";
  return "";
};

/** The copy key for a SpeechRecognition error code, or "" for one that needs no toast. */
export const nativeErrorKey = (code = "") => {
  switch (String(code)) {
    case "not-allowed":
      return VOICE_ERROR_KEYS.denied;
    case "no-speech":
      return VOICE_ERROR_KEYS.noSpeech;
    case "audio-capture":
      return VOICE_ERROR_KEYS.noMic;
    case "aborted":
      return "";
    default:
      return VOICE_ERROR_KEYS.failed;
  }
};

export const transcriptFromResults = (results) => {
  let text = "";
  let final = false;
  for (let index = 0; index < (results?.length || 0); index += 1) {
    const result = results[index];
    text += result?.[0]?.transcript || "";
    final = Boolean(result?.isFinal);
  }
  return { text: text.replace(/\s+/g, " ").trim(), final };
};

/**
 * Starts one listening session. Returns `{ engine, stop }`; `stop()` ends listening early (a second
 * tap on the mic) and still delivers whatever was said.
 *
 * Callbacks: onState("listening" | "transcribing"), onTranscript(text, { final }), onError(copyKey),
 * onEnd() — always called exactly once.
 */
export const startVoiceSearch = ({
  language = "ar",
  onState = () => {},
  onTranscript = () => {},
  onError = () => {},
  onEnd = () => {},
  transcribeClip = null,
} = {}) => {
  const Recogniser = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
  const canRecord = Boolean(
    typeof window !== "undefined" &&
    typeof transcribeClip === "function" &&
    window.MediaRecorder &&
    navigator?.mediaDevices?.getUserMedia
  );
  const engine = chooseVoiceEngine({
    hasRecogniser: Boolean(Recogniser),
    canRecord,
    iosLike: isIosLike(),
    serverState: readServerState(),
  });

  let ended = false;
  const finish = () => {
    if (ended) return;
    ended = true;
    onEnd();
  };

  if (!engine) {
    onError(VOICE_ERROR_KEYS.unsupported);
    finish();
    return { engine: "", stop: () => {} };
  }

  const session = { engine, stop: () => {} };

  const runRecorder = () => {
    session.engine = "recorder";
    let stopped = false;
    let recorder = null;
    let stream = null;
    let audioContext = null;
    let frame = 0;
    let speechHeard = false;
    const timers = [];
    const chunks = [];
    const startedAt = Date.now();
    let lastVoiceAt = 0;

    // Created inside the tap, before any await: Safari will not start an AudioContext later.
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      audioContext = Context ? new Context() : null;
    } catch {
      audioContext = null;
    }

    const cleanup = () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      if (frame) window.cancelAnimationFrame(frame);
      stream?.getTracks?.().forEach((track) => track.stop());
      audioContext?.close?.().catch?.(() => {});
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else {
        cleanup();
        finish();
      }
    };
    session.stop = stop;

    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((mediaStream) => {
        stream = mediaStream;
        if (stopped || ended) {
          cleanup();
          finish();
          return;
        }
        const mimeType = pickRecorderMime();
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        recorder.onstop = async () => {
          cleanup();
          const type = recorder.mimeType || mimeType || "audio/webm";
          const blob = new Blob(chunks, { type });
          // A meter that never moved means nothing was said (or no analyser to tell): only a clip
          // with some substance is worth a paid transcription.
          if ((audioContext && !speechHeard) || blob.size < 1200) {
            onError(VOICE_ERROR_KEYS.noSpeech);
            finish();
            return;
          }
          onState("transcribing");
          try {
            const text = String((await transcribeClip(blob, type, language)) || "").trim();
            writeServerState("available");
            if (text) onTranscript(text, { final: true });
            else onError(VOICE_ERROR_KEYS.noSpeech);
          } catch (error) {
            const status = Number(error?.status || error?.response?.status || 0);
            // No provider on this server (or an older backend without the route): stop sending
            // clips there for the rest of the visit and let the next tap use the recogniser.
            if (status === 503 || status === 404) writeServerState("unavailable");
            onError(VOICE_ERROR_KEYS.failed);
          }
          finish();
        };
        recorder.start(250);
        onState("listening");

        if (audioContext) {
          audioContext.resume?.().catch?.(() => {});
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 1024;
          audioContext.createMediaStreamSource(stream).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          const tick = () => {
            if (stopped) return;
            analyser.getFloatTimeDomainData(samples);
            let sum = 0;
            for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
            const rms = Math.sqrt(sum / samples.length);
            const now = Date.now();
            if (rms > SPEECH_RMS) {
              speechHeard = true;
              lastVoiceAt = now;
            }
            if (speechHeard && now - lastVoiceAt > TRAILING_SILENCE_MS) return stop();
            if (!speechHeard && now - startedAt > NO_SPEECH_GIVE_UP_MS) return stop();
            frame = window.requestAnimationFrame(tick);
          };
          frame = window.requestAnimationFrame(tick);
        }
        timers.push(window.setTimeout(stop, MAX_RECORDING_MS));
      })
      .catch((error) => {
        cleanup();
        const name = String(error?.name || "");
        onError(name === "NotAllowedError" || name === "SecurityError" ? VOICE_ERROR_KEYS.denied : VOICE_ERROR_KEYS.noMic);
        finish();
      });
  };

  const runNative = () => {
    const recognition = new Recogniser();
    recognition.lang = String(language).startsWith("en") ? "en-US" : "ar-EG";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    let heard = false;
    let failed = false;
    let handedOver = false;
    const safety = window.setTimeout(() => recognition.stop(), NATIVE_SAFETY_MS);

    recognition.onresult = (event) => {
      const { text, final } = transcriptFromResults(event.results);
      if (!text) return;
      heard = true;
      onTranscript(text, { final });
    };
    recognition.onerror = (event) => {
      failed = true;
      const code = String(event?.error || "");
      // Siri & Dictation off (iOS) or the recogniser's service unreachable: record instead.
      if ((code === "service-not-allowed" || code === "network") && canRecord && readServerState() !== "unavailable" && !heard) {
        handedOver = true;
        return;
      }
      const key = nativeErrorKey(code);
      if (key) onError(key);
    };
    recognition.onend = () => {
      window.clearTimeout(safety);
      if (handedOver) {
        runRecorder();
        return;
      }
      if (!heard && !failed) onError(VOICE_ERROR_KEYS.noSpeech);
      finish();
    };
    session.stop = () => recognition.stop();
    try {
      recognition.start();
      onState("listening");
    } catch {
      window.clearTimeout(safety);
      if (canRecord) runRecorder();
      else {
        onError(VOICE_ERROR_KEYS.failed);
        finish();
      }
    }
  };

  if (engine === "recorder") runRecorder();
  else runNative();
  return session;
};
