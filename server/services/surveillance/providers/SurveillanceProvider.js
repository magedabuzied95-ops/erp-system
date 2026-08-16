// Surveillance Center — the vendor abstraction.
//
// WHAT BELONGS IN A PROVIDER
// --------------------------
// A provider knows ONE thing: how to speak a vendor's protocol. It translates
// "get the encoder config for channel 3" into whatever CGI call, ISAPI path, or
// ONVIF SOAP body that vendor wants, and translates the answer back into the
// neutral shapes documented below.
//
// WHAT DOES NOT BELONG IN A PROVIDER
// ----------------------------------
//   * Reachability. A provider never opens a socket itself and never sees an IP
//     it chose. It asks its DeviceTransport, which may be a direct connection,
//     a VPN route, or an RPC to an agent inside a customer's shop. This is the
//     separation that lets the same DahuaAdapter work on a LAN today and behind
//     a site agent in a SaaS deployment later, with no change.
//   * Persistence. Providers do not touch the database.
//   * Authorisation. By the time a provider method runs, permission, tenant and
//     capability checks have already passed.
//   * Credential storage. A provider receives a decrypted credential for the
//     duration of one call and must not retain, log, or embed it in a value it
//     returns.
//
// CAPABILITIES ARE DISCOVERED, NOT DECLARED
// -----------------------------------------
// `getCapabilities()` must probe the actual device. Returning a hardcoded table
// keyed off the model string is the failure mode this class exists to prevent:
// two units of the same model on different firmware genuinely differ, and a
// wrong `supported` becomes a button that throws in the user's face.
//
// EVERY METHOD IS OPTIONAL, NO METHOD IS SILENT
// ---------------------------------------------
// The base implementations throw NotImplementedError. An adapter that has not
// implemented PTZ therefore fails loudly and traceably rather than returning
// undefined and producing a blank panel. Since the capability gate runs first,
// a correctly-probed device never reaches a method its adapter lacks — so any
// NotImplementedError in production is a real bug in the probe, and it is
// visible as one.

import { NotImplementedError } from "../surveillanceErrors.js";

export class SurveillanceProvider {
  /** Stable key stored in surveillance_devices.vendor_key. Never localised. */
  static vendorKey = "";

  /** Human label for the Add Device wizard. */
  static displayName = "";

  /** Default port used to pre-fill the wizard. Never used as a fallback at runtime. */
  static defaultPort = 80;

  /**
   * @param {object} options
   * @param {import("../transports/DeviceTransport.js").DeviceTransport} options.transport
   * @param {{ username: string, password: string }} options.credentials  decrypted, call-scoped
   * @param {object} options.device  the row, minus credentials
   */
  constructor({ transport, credentials, device } = {}) {
    if (new.target === SurveillanceProvider) {
      throw new NotImplementedError("SurveillanceProvider is abstract");
    }
    this.transport = transport;
    // Held for the lifetime of this instance, which is one request. Never
    // written to a field that gets serialised, never logged. `toJSON` below
    // makes accidental serialisation safe.
    this.credentials = credentials || null;
    this.device = device || null;
  }

  get vendorKey() {
    return this.constructor.vendorKey;
  }

  /**
   * Guard against `JSON.stringify(provider)` and against a debugger dump or an
   * error serialiser walking the object graph and finding `credentials`.
   */
  toJSON() {
    return { vendorKey: this.vendorKey, deviceId: this.device?.id ?? null };
  }

  /* ---- connection ---------------------------------------------------- */

  /** @returns {Promise<{ ok: boolean, latencyMs: number, authMethod: string }>} */
  async testConnection() {
    throw new NotImplementedError(`${this.vendorKey}.testConnection`);
  }

  /** @returns {Promise<{ model, firmware, serial, deviceType, channelCount }>} */
  async getDeviceInfo() {
    throw new NotImplementedError(`${this.vendorKey}.getDeviceInfo`);
  }

  /**
   * Probe the device and report what it can actually do.
   * @returns {Promise<Record<string, "supported"|"unsupported"|"unknown"|"read-only">>}
   */
  async getCapabilities() {
    throw new NotImplementedError(`${this.vendorKey}.getCapabilities`);
  }

  /* ---- channels ------------------------------------------------------ */

  /** @returns {Promise<Array<{ index, vendorName, enabled, ptz, mainCodec, subCodec }>>} */
  async getChannels() {
    throw new NotImplementedError(`${this.vendorKey}.getChannels`);
  }

  /** @returns {Promise<{ online: boolean, recording: boolean, signalLost: boolean }>} */
  async getChannelStatus(_channelIndex) {
    throw new NotImplementedError(`${this.vendorKey}.getChannelStatus`);
  }

  /* ---- media --------------------------------------------------------- */

  /**
   * Build the credentialed source URL for the media gateway.
   *
   * CRITICAL: the return value of this method must never reach an HTTP response.
   * It contains the device credentials in the userinfo segment. It is consumed
   * only by MediaGateway.ensurePath(), server-side, and the browser receives a
   * gateway URL plus a short-lived ticket instead.
   *
   * @returns {{ url: string, transport: "tcp"|"udp", codecHint: string }}
   */
  buildStreamSource(_channelIndex, _options) {
    throw new NotImplementedError(`${this.vendorKey}.buildStreamSource`);
  }

  /** @returns {Promise<Buffer>} */
  async getSnapshot(_channelIndex) {
    throw new NotImplementedError(`${this.vendorKey}.getSnapshot`);
  }

  /* ---- playback ------------------------------------------------------ */

  /** @returns {Promise<Array<{ startedAt, endedAt, sizeBytes, type }>>} */
  async searchRecordings(_channelIndex, _from, _to) {
    throw new NotImplementedError(`${this.vendorKey}.searchRecordings`);
  }

  /** Same credential warning as buildStreamSource. */
  buildPlaybackSource(_channelIndex, _from, _to) {
    throw new NotImplementedError(`${this.vendorKey}.buildPlaybackSource`);
  }

  /* ---- configuration ------------------------------------------------- */

  async getStorageInfo() {
    throw new NotImplementedError(`${this.vendorKey}.getStorageInfo`);
  }

  async getRecordingConfig(_channelIndex) {
    throw new NotImplementedError(`${this.vendorKey}.getRecordingConfig`);
  }

  async updateRecordingConfig(_channelIndex, _config) {
    throw new NotImplementedError(`${this.vendorKey}.updateRecordingConfig`);
  }

  async getEncoderConfig(_channelIndex) {
    throw new NotImplementedError(`${this.vendorKey}.getEncoderConfig`);
  }

  async updateEncoderConfig(_channelIndex, _config) {
    throw new NotImplementedError(`${this.vendorKey}.updateEncoderConfig`);
  }

  async getMotionConfig(_channelIndex) {
    throw new NotImplementedError(`${this.vendorKey}.getMotionConfig`);
  }

  async updateMotionConfig(_channelIndex, _config) {
    throw new NotImplementedError(`${this.vendorKey}.updateMotionConfig`);
  }

  /** Read-only in the first version. See the capability model's "read-only" state. */
  async getNetworkInfo() {
    throw new NotImplementedError(`${this.vendorKey}.getNetworkInfo`);
  }

  async getSystemTime() {
    throw new NotImplementedError(`${this.vendorKey}.getSystemTime`);
  }

  async updateSystemTime(_payload) {
    throw new NotImplementedError(`${this.vendorKey}.updateSystemTime`);
  }

  /* ---- control ------------------------------------------------------- */

  /** @param {{ action, direction?, speed?, preset? }} _command */
  async ptzControl(_channelIndex, _command) {
    throw new NotImplementedError(`${this.vendorKey}.ptzControl`);
  }

  async restartDevice() {
    throw new NotImplementedError(`${this.vendorKey}.restartDevice`);
  }
}

export default SurveillanceProvider;
