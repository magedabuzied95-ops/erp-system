// MediaMTX + FFmpeg gateway.
//
// PROVEN AGAINST THE REAL RECORDER on 2026-08-18: one channel of a
// DH-XVR1B16-I, H.265 352x288 @7fps, transcoded to H.264 and played in a
// browser over WebRTC at 7.05 fps for ten minutes, ~2% of one CPU core.
//
// DIVISION OF LABOUR — STATED PRECISELY
// -------------------------------------
// MediaMTX does NOT transcode. It is the session, distribution, auth and
// lifecycle layer. FFmpeg is the codec bridge. Every design that claimed
// otherwise died when the probe found the recorder is H.265 on every stream.
//
// TWO HOPS, AND WHY
// -----------------
// The obvious pipeline hands FFmpeg the credentialed RTSP URL:
//
//   ffmpeg -i rtsp://user:pass@192.168.1.108/...
//
// which puts a DVR password in a process command line that Task Manager, `ps`,
// any local user and any crash dump can read. There is no way to hide argv from
// the same user on Windows or Linux.
//
// So MediaMTX authenticates to the recorder instead, and FFmpeg reads the
// already-authenticated stream back over loopback:
//
//   recorder --(RTSP, credential held in memory)--> MediaMTX  <vendor>_raw
//            --(RTSP, loopback, no credential)--> FFmpeg  H.265 -> H.264
//            --(RTSP, loopback, no credential)--> MediaMTX  <path>
//            --(WHEP)--> browser
//
// The extra loopback hop costs single-digit milliseconds and removes the
// credential from every process command line and every FFmpeg log line.
//
// AND THE CREDENTIAL IS NEVER ON DISK EITHER
// ------------------------------------------
// The POC put the source URL in `mediamtx.yml`, which solved argv exposure by
// creating a cleartext password on disk instead. Paths are now pushed through
// the control API when a viewer asks for a stream. Measured: after adding a
// path whose password was a canary, the config file's hash was unchanged and
// the canary appeared nowhere on disk and nowhere in the logs.
//
// The trade is that the running config is readable back from that API, so the
// API is now as sensitive as the credentials in it. mediaHostConfig.js refuses
// to use one that is not bound to loopback.
//
// WHAT THE BROWSER GETS
// ---------------------
// A path name and a short-lived ticket. Never an RTSP URL, never a credential,
// never the recorder's address. Enforced by MediaGateway.

import { MediaGateway, buildTicketClaims, signTicket } from "./MediaGateway.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";
import { surveillanceLog, surveillanceLogError } from "../surveillanceRedaction.js";
import { decoderInputArgs, encoderOutputArgs } from "./mediaEncoderPolicy.js";
import { assertApiIsLoopback } from "./mediaHostConfig.js";

/**
 * FFmpeg arguments for one transcode.
 *
 * Every flag here was chosen against the real stream, and two of them are
 * corrections of things that went wrong the first time:
 *
 *   -fps_mode passthrough  The RTSP muxer otherwise targets a constant frame
 *                          rate and DUPLICATES frames to fill it. The first run
 *                          logged over a thousand duplicates and reported 100
 *                          fps out of a 7 fps camera, burning CPU inventing
 *                          frames. With passthrough, measured output matched
 *                          the source exactly at 7.05 fps.
 *   -an                    The recorder reports audio disabled on every channel.
 *                          Carrying a silent track costs packets for nothing.
 *
 * Resolution and frame rate are never changed. Upscaling CIF would multiply the
 * encode cost to invent detail that is not in the source.
 *
 * The codec flags come from mediaEncoderPolicy rather than being written here,
 * because which encoder is correct is a property of the HOST, not of this
 * gateway: measured on the shop laptop, libx264 costs 0.702 CPU cores per
 * camera and h264_qsv costs 0.049. Hardcoding either one would be wrong on
 * half the machines this will run on.
 */
export const buildTranscodeArgs = ({
  inputUrl,
  outputUrl,
  bitrateKbps = 150,
  fps = 7,
  encoder = "libx264",
  sourceCodec = "",
}) => [
  "-hide_banner",
  "-loglevel", "warning",
  "-rtsp_transport", "tcp",
  // Hardware decode, when the encoder and the source codec agree on one. Empty
  // for software decode, which is safe: decode was never the expensive half.
  ...decoderInputArgs(encoder, { sourceCodec }),
  "-i", inputUrl,
  "-fps_mode", "passthrough",
  // Rate control is encoder-specific. An x264 argument list handed to QSV
  // either errors or silently produces the wrong bitrate.
  ...encoderOutputArgs(encoder, { bitrateKbps, fps }),
  "-an",
  "-f", "rtsp",
  "-rtsp_transport", "tcp",
  outputUrl,
];

export class MediaMtxGateway extends MediaGateway {
  static gatewayKey = "mediamtx";
  static displayName = "MediaMTX + FFmpeg";

  constructor({ config = {} } = {}) {
    super({ config });
    this.baseUrl = String(config.baseUrl || process.env.SURVEILLANCE_MEDIA_URL || "").replace(/\/$/, "");
    this.apiUrl = String(config.apiUrl || process.env.SURVEILLANCE_MEDIA_API_URL || "").replace(/\/$/, "");
    this.rtspUrl = String(config.rtspUrl || process.env.SURVEILLANCE_MEDIA_RTSP_URL || "").replace(/\/$/, "");
    // MediaMTX runs this string as a command line, so a path with a space in it
    // must arrive quoted. "C:\Program Files\ffmpeg\ffmpeg.exe" otherwise
    // becomes the command "C:\Program" with "Files\..." as its first argument.
    const binary = String(config.ffmpegPath || process.env.SURVEILLANCE_FFMPEG_PATH || "ffmpeg");
    this.ffmpegBinary = /\s/.test(binary) ? `"${binary}"` : binary;
  }

  #assertConfigured() {
    if (!this.baseUrl || !this.apiUrl) {
      throw new SurveillanceError("media gateway is not configured for this deployment", {
        code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
        status: 503,
      });
    }
    // Every credential this gateway pushes is readable back from the control
    // API. Checking on each use rather than once at startup is deliberate:
    // the URL comes from the environment, and a deployment that changes it
    // later should fail immediately rather than at the next restart.
    assertApiIsLoopback(this.apiUrl);
  }

  /**
   * Ensure a transcoded path exists and hand back what the browser needs.
   *
   * `sourceUrl` is CREDENTIALED and is written into the media server's own
   * configuration, never returned and never logged.
   */
  async ensurePath({
    tenantId, deviceId, channelId, userId, stream = "sub", sourceUrl,
    fps, bitrateKbps, ttlSeconds = 60, encoder = "libx264", sourceCodec = "",
  }) {
    this.#assertConfigured();
    if (!sourceUrl) {
      throw new SurveillanceError("no source URL supplied for the stream", {
        code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
        status: 400,
      });
    }

    const pathName = this.pathNameFor({ tenantId, deviceId, channelId, stream });
    const rawPath = `${pathName}_raw`;

    // The raw path carries the credential; the published path never does.
    await this.#configurePath(rawPath, {
      source: sourceUrl,
      rtspTransport: "tcp",
      // On-demand: the recorder is only dialled while somebody is watching.
      //
      // The POC had to disable this, because a 10 s close tore the source down
      // underneath a running FFmpeg. 30 s is now PROVEN rather than guessed —
      // scripts/surveillance-probe/lifecycleProof covers 13 scenarios against
      // real OS processes, including the two that matter most: a second viewer
      // reuses the running transcode instead of starting another, and a
      // reconnect inside the grace window reuses it rather than restarting.
      sourceOnDemand: true,
      sourceOnDemandCloseAfter: "30s",
    });

    await this.#configurePath(pathName, {
      runOnDemand: this.#ffmpegCommand({ rawPath, pathName, fps, bitrateKbps, encoder, sourceCodec }),
      runOnDemandRestart: true,
      // Grace period after the last viewer leaves, so switching layouts does not
      // restart an encoder that is about to be needed again.
      runOnDemandCloseAfter: "10s",
      runOnDemandStartTimeout: "15s",
    });

    const claims = buildTicketClaims({ tenantId, userId, deviceId, channelId, stream, ttlSeconds });

    surveillanceLog("media_path_ready", { tenantId, deviceId, channelId, stream });

    return {
      pathName,
      // WHEP is the browser-facing endpoint. No credential, no device address.
      whepUrl: `${this.baseUrl}/${pathName}/whep`,
      ticket: signTicket(claims),
      expiresIn: ttlSeconds,
    };
  }

  /**
   * The FFmpeg command MediaMTX runs on demand.
   *
   * Both URLs are loopback and carry no credential — that is the entire point of
   * the two-hop design.
   */
  #ffmpegCommand({ rawPath, pathName, fps, bitrateKbps, encoder, sourceCodec }) {
    const input = `${this.rtspUrl}/${rawPath}`;
    const output = `${this.rtspUrl}/${pathName}`;
    return [
      this.ffmpegBinary,
      ...buildTranscodeArgs({ inputUrl: input, outputUrl: output, fps, bitrateKbps, encoder, sourceCodec }),
    ].join(" ");
  }

  async #configurePath(name, settings) {
    const response = await fetch(`${this.apiUrl}/v3/config/paths/add/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings),
    }).catch((error) => {
      // Never surface the raw error: `settings` contains the credentialed
      // source URL and some fetch implementations echo the request.
      surveillanceLogError("media_path_configure_failed", new Error(error?.code || "fetch failed"), { path: name });
      throw new SurveillanceError("media gateway did not accept the path", {
        code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
        status: 503,
      });
    });

    // 400 with "path already exists" is success for our purposes: re-requesting
    // a stream that is already running must reuse it, not fail.
    if (!response.ok && response.status !== 400) {
      throw new SurveillanceError("media gateway rejected the path configuration", {
        code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
        status: 503,
        details: { upstreamStatus: response.status },
      });
    }
    return true;
  }

  async releasePath(pathName) {
    this.#assertConfigured();
    for (const name of [pathName, `${pathName}_raw`]) {
      await fetch(`${this.apiUrl}/v3/config/paths/delete/${encodeURIComponent(name)}`, { method: "POST" })
        .catch(() => {});
    }
    return true;
  }

  async getStats() {
    this.#assertConfigured();
    const response = await fetch(`${this.apiUrl}/v3/paths/list`).catch(() => null);
    if (!response?.ok) return { paths: 0, viewers: 0 };
    const body = await response.json().catch(() => ({ items: [] }));
    const items = Array.isArray(body.items) ? body.items : [];
    return {
      paths: items.length,
      viewers: items.reduce((sum, item) => sum + (Array.isArray(item.readers) ? item.readers.length : 0), 0),
    };
  }

  async healthCheck() {
    if (!this.apiUrl) return { ok: false, reason: "not-configured" };
    const response = await fetch(`${this.apiUrl}/v3/paths/list`).catch(() => null);
    return { ok: Boolean(response?.ok), reason: response?.ok ? "" : "unreachable" };
  }
}

export default MediaMtxGateway;
