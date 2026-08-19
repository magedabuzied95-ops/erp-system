// ONVIF Profile G recording search and replay.
//
// WHY THIS IS PREFERRED OVER DAHUA'S mediaFileFind
// ------------------------------------------------
// `mediaFileFind` allocates a finder object ON THE RECORDER, returns at most
// 100 files per call, and leaks handles until the device stops answering if it
// is not closed. It is a vendor-specific API that has to be reimplemented for
// every future recorder brand.
//
// Profile G is a standard: the same six operations work on Hikvision, Uniview
// and any ONVIF recorder, and the device filters by time window so a day of
// footage is never dragged across the network to be filtered here.
//
// WHAT IS NOT PROVEN
// ------------------
// That this recorder ACCEPTS Profile G with the ERP's existing credentials.
// The repository contains ONVIF probe calls whose stated purpose is to
// "separate no-ONVIF from needs-its-own-account", and no recorded result for
// them. Dahua's own documentation says ONVIF may require a SEPARATE account
// created under System > Account > ONVIF User — and creating a recorder user is
// an explicit approval gate this build must not cross.
//
// So `probeSupport()` exists to answer that question with one read-only call,
// and every failure mode it can return is distinguished, because "ONVIF failed"
// is not an actionable answer:
//
//   supported       Profile G works with the credentials we already hold
//   needs-account   the device answered, and refused these credentials
//   not-supported   the firmware does not implement the service at all
//   unreachable     nothing answered on the ONVIF endpoint
//
// Only `supported` selects this path. Anything else falls back to the Dahua
// implementation, which is already written and tested — and the reason is
// recorded rather than silently swallowed.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../../surveillanceErrors.js";
import { surveillanceLog, surveillanceLogError } from "../../surveillanceRedaction.js";
import { bodies, envelope, extractAll, extractFirst, readFault } from "./onvifSoap.js";

const DEVICE_SERVICE_PATH = "/onvif/device_service";

/** ONVIF wants xs:dateTime in UTC. */
export const onvifTime = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");

export class OnvifRecordingClient {
  /**
   * @param {object} options
   * @param {object} options.transport approved transport — the SAME guard the
   *        vendor adapters use. ONVIF must not get its own network path.
   */
  constructor({ transport, credentials, device } = {}) {
    this.transport = transport;
    this.credentials = credentials;
    this.device = device;
  }

  async #soap(path, body, { timeoutMs = 10000 } = {}) {
    const payload = envelope(body, this.credentials);
    const response = await this.transport.request({
      method: "POST",
      path,
      headers: { "content-type": "application/soap+xml; charset=utf-8" },
      body: payload,
      timeoutMs,
    });

    const text = typeof response?.body === "string" ? response.body : String(response?.body ?? "");
    const fault = readFault(text);
    if (fault) {
      // Map to the code that actually MEANS this, so the API surfaces the same
      // vocabulary as every other device failure rather than a bespoke one.
      const code =
        fault.kind === "not-authorized" ? SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED
          : fault.kind === "not-supported" ? SURVEILLANCE_ERROR_CODES.CAPABILITY_UNSUPPORTED
            : SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED;
      const error = new SurveillanceError("the recorder rejected an ONVIF request", {
        code,
        status: fault.kind === "not-authorized" ? 502 : 501,
        // The KIND, never the device's own reason string: a SOAP fault can
        // echo the username back in its text.
        details: { onvif: fault.kind },
      });
      error.onvifFault = fault;
      throw error;
    }
    return text;
  }

  /**
   * One read-only call that answers "can we use Profile G here?".
   *
   * GetServices is the right probe: it is a read, it requires credentials on
   * this firmware, and its response says which services exist. A failure
   * separates the four outcomes rather than reporting a boolean.
   */
  async probeSupport() {
    let xml;
    try {
      xml = await this.#soap(DEVICE_SERVICE_PATH, bodies.getServices(), { timeoutMs: 6000 });
    } catch (error) {
      const kind = error?.onvifFault?.kind;
      if (kind === "not-authorized") {
        // The endpoint EXISTS and refused us. On Dahua that usually means ONVIF
        // is enabled but wants its own account — which needs approval.
        return { state: "needs-account", reason: "onvif-rejected-credentials" };
      }
      if (kind === "not-supported") return { state: "not-supported", reason: "service-not-implemented" };
      surveillanceLogError("onvif_probe_failed", error, { deviceId: this.device?.id });
      return { state: "unreachable", reason: "no-response" };
    }

    const namespaces = extractAll(xml, "Namespace");
    const has = (fragment) => namespaces.some((ns) => ns.includes(fragment));
    const services = {
      recording: has("recording/wsdl"),
      search: has("search/wsdl"),
      replay: has("replay/wsdl"),
    };

    // Profile G needs all three. A device advertising only `recording` can list
    // what it has but cannot be searched or replayed, which is not playback.
    if (!services.recording || !services.search || !services.replay) {
      return { state: "not-supported", reason: "profile-g-incomplete", services };
    }
    return { state: "supported", reason: "profile-g-complete", services };
  }

  /**
   * Recordings within a window.
   *
   * The search token is a device-side resource and is released in a `finally`,
   * including when the search throws. Leaking these is how a recorder is
   * gradually driven to stop answering.
   */
  async searchRecordings({ from, to, recordingToken = "", maxMatches = 200 }) {
    const started = await this.#soap(
      DEVICE_SERVICE_PATH,
      bodies.findRecordings({ from: onvifTime(from), to: onvifTime(to), recordingToken, maxMatches }),
    );
    const searchToken = extractFirst(started, "SearchToken");
    if (!searchToken) {
      throw new SurveillanceError("the recorder did not start a recording search", {
        code: SURVEILLANCE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
        status: 501,
      });
    }

    try {
      const results = [];
      // Bounded: a recorder with a year of footage must not hold this request
      // open indefinitely, and the UI never needs more than a day at a time.
      for (let page = 0; page < 20; page += 1) {
        const xml = await this.#soap(
          DEVICE_SERVICE_PATH,
          bodies.getRecordingSearchResults({ searchToken, maxResults: 200 }),
        );
        const batch = this.#parseResults(xml);
        results.push(...batch);
        if (/<(?:[A-Za-z0-9_.-]+:)?SearchState>\s*Completed/.test(xml) || batch.length === 0) break;
      }
      surveillanceLog("onvif_search_complete", { deviceId: this.device?.id, results: results.length });
      return results;
    } finally {
      await this.#soap(DEVICE_SERVICE_PATH, bodies.endSearch({ searchToken })).catch(() => {});
    }
  }

  #parseResults(xml) {
    const tokens = extractAll(xml, "RecordingToken");
    const earliest = extractAll(xml, "EarliestRecording");
    const latest = extractAll(xml, "LatestRecording");
    return tokens.map((token, index) => ({
      recordingToken: token,
      startedAt: earliest[index] || null,
      endedAt: latest[index] || null,
    }));
  }

  /**
   * The replay URI for one recording.
   *
   * CREDENTIALED once the device fills in userinfo. Treated exactly like a live
   * source: consumed server-side by the media gateway, never returned from an
   * API, never logged.
   */
  async buildReplaySource(recordingToken) {
    const xml = await this.#soap(DEVICE_SERVICE_PATH, bodies.getReplayUri({ recordingToken }));
    const uri = extractFirst(xml, "Uri");
    if (!uri) {
      throw new SurveillanceError("the recorder returned no replay URI", {
        code: SURVEILLANCE_ERROR_CODES.CAPABILITY_UNSUPPORTED,
        status: 501,
      });
    }
    return { url: uri, transport: "tcp", codecHint: "" };
  }
}

export default OnvifRecordingClient;
