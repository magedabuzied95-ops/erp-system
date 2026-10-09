/*
 * Making a recorded voice note playable by the people who SENT it.
 *
 * MediaRecorder gives each browser its own container: Chrome writes
 * audio/webm;codecs=opus, Safari writes audio/mp4. The customer never sees that
 * difference — Evolution transcodes for WhatsApp — but our own transcript does:
 * Safari and every browser on iOS cannot decode WebM at all, so a note recorded
 * at a desk played back on the owner's phone as "المرفق غير متاح" while the
 * customer was listening to it happily.
 *
 * So anything the Apple stack cannot read is re-encoded here, in the browser
 * that recorded it, to 16 kHz mono WAV: the one format that every browser both
 * decodes and plays, that every channel accepts, and that needs no ffmpeg on a
 * server that does not have one. Voice at 16 kHz is ~32 KB/s — a minute is under
 * 2 MB, well inside the 16 MB channel ceiling.
 *
 * An m4a from Safari is already universal and is passed through untouched.
 */

/** Containers that play everywhere, including iOS. */
const UNIVERSAL_AUDIO = [/^audio\/mp4/, /^audio\/aac/, /^audio\/mpeg/, /^audio\/wav/, /^audio\/x-wav/];

export const VOICE_NOTE_SAMPLE_RATE = 16000;

export const isUniversallyPlayableAudio = (mimeType = "") => {
  const type = String(mimeType || "").trim().toLowerCase();
  return UNIVERSAL_AUDIO.some((pattern) => pattern.test(type));
};

/** Average the channels down to one: a voice note is never stereo content. */
export const downmixToMono = (channels = [], length = 0) => {
  const count = channels.length;
  if (!count) return new Float32Array(0);
  if (count === 1) return channels[0];
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < count; c += 1) sum += channels[c][i] || 0;
    mono[i] = sum / count;
  }
  return mono;
};

/** Linear resample. Good enough for speech, and it costs nothing to read. */
export const resampleMono = (samples, fromRate, toRate) => {
  if (!samples?.length || !fromRate || fromRate === toRate) return samples || new Float32Array(0);
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    out[i] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return out;
};

/** A 16-bit PCM WAV, header and all. */
export const encodeWav = (samples, sampleRate = VOICE_NOTE_SAMPLE_RATE) => {
  const data = samples || new Float32Array(0);
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: mono, 2 bytes a sample
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i += 1) {
    // Clamped before scaling: a sample outside [-1, 1] wraps around into noise.
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
};

export const wavFileName = (name = "voice.webm") =>
  `${String(name || "voice").replace(/\.[^.]+$/, "")}.wav`;

/**
 * The recording as it should be stored. Returns the file untouched when the
 * browser already produced something iOS can play, and NEVER throws: a failed
 * conversion sends the original, because a note the customer can hear beats no
 * note at all.
 */
export const normalizeVoiceNote = async (file, { AudioContextImpl = null } = {}) => {
  if (!file) return file;
  if (isUniversallyPlayableAudio(file.type)) return file;
  const Context = AudioContextImpl
    || (typeof window !== "undefined" ? (window.AudioContext || window.webkitAudioContext) : null);
  if (!Context) return file;
  let context = null;
  try {
    const bytes = await file.arrayBuffer();
    context = new Context();
    const decoded = await context.decodeAudioData(bytes);
    const channels = [];
    for (let c = 0; c < decoded.numberOfChannels; c += 1) channels.push(decoded.getChannelData(c));
    const mono = downmixToMono(channels, decoded.length);
    const resampled = resampleMono(mono, decoded.sampleRate, VOICE_NOTE_SAMPLE_RATE);
    const wav = encodeWav(resampled, VOICE_NOTE_SAMPLE_RATE);
    if (!wav.byteLength) return file;
    return new File([wav], wavFileName(file.name), { type: "audio/wav", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    // An AudioContext left open counts against the browser's limit.
    try {
      await context?.close?.();
    } catch {
      /* already closed */
    }
  }
};

export default normalizeVoiceNote;
