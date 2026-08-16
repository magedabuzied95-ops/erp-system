// Surveillance Center — the reachability abstraction.
//
// WHY THIS IS A SEPARATE AXIS FROM THE PROVIDER
// ---------------------------------------------
// "Which vendor is this?" and "how do I reach it?" are independent questions,
// and systems that conflate them cannot be resold. A Dahua XVR might be:
//
//   * on the same LAN as the ERP (a self-hosted customer)      → DirectTransport
//   * across a WireGuard tunnel from a cloud VPS (us, today)   → TunnelTransport
//   * behind an agent inside the shop, dialling out to us      → AgentTransport
//
// The CGI dialect is identical in all three. If reachability lived inside
// DahuaAdapter, every one of those deployments would fork the adapter, and the
// second vendor would fork it again — the classic n×m explosion. Kept apart,
// adding a transport costs one class and adding a vendor costs one class.
//
// THE GUARD IS IN THE BASE, NOT IN THE SUBCLASSES
// -----------------------------------------------
// `resolveDestination()` is final in spirit: every subclass must route its
// connections through it, and it always runs the SSRF guard. Putting the check
// in the base rather than trusting each transport to remember it means a future
// transport cannot quietly skip it — the only way to get an address to dial is
// to ask for one, and asking runs the guard.
//
// The address it returns is PINNED. Subclasses must connect to
// `destination.address` and pass the original hostname only as a Host header or
// TLS SNI value. Handing the hostname to the socket layer would let it resolve
// a second time, and a second resolution is a rebinding window.

import { NotImplementedError, SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";
import { assertNotRedirect, resolveDestination } from "../surveillanceNetworkGuard.js";

export class DeviceTransport {
  /** Stable key stored in surveillance_devices.transport_type. */
  static transportKey = "";

  static displayName = "";

  /**
   * @param {object} options
   * @param {object} options.device        the device row (host, port, protocol)
   * @param {string[]} options.allowedCidrs the tenant's granted destination ranges
   * @param {number} options.timeoutMs
   */
  constructor({ device, allowedCidrs = [], timeoutMs = 10000 } = {}) {
    if (new.target === DeviceTransport) {
      throw new NotImplementedError("DeviceTransport is abstract");
    }
    this.device = device || null;
    // An empty allowlist denies everything. That is deliberate: a device whose
    // tenant has no provisioned network grant must not be reachable, and the
    // safe default for "we haven't set this up yet" is "no".
    this.allowedCidrs = Array.isArray(allowedCidrs) ? allowedCidrs.filter(Boolean) : [];
    this.timeoutMs = timeoutMs;
    this._destination = null;
  }

  get transportKey() {
    return this.constructor.transportKey;
  }

  /** Never serialise a transport with its device row attached. */
  toJSON() {
    return { transportKey: this.transportKey, deviceId: this.device?.id ?? null };
  }

  /**
   * The one place an address to dial comes from.
   *
   * Memoised per instance (one request), so a provider making six calls pays
   * one DNS lookup and — more importantly — cannot end up dialling two
   * different addresses within a single logical operation.
   */
  async resolveDestination() {
    if (this._destination) return this._destination;

    const host = this.device?.host;
    const port = this.device?.port;
    if (!host || !port) {
      throw new SurveillanceError("device has no host or port configured", {
        code: SURVEILLANCE_ERROR_CODES.VALIDATION_FAILED,
        status: 400,
      });
    }

    this._destination = await resolveDestination(host, port, {
      allowedCidrs: this.allowedCidrs,
      timeoutMs: Math.min(this.timeoutMs, 4000),
    });
    return this._destination;
  }

  /**
   * Subclasses call this on every response before reading a body.
   * Centralised so "we do not follow redirects" is one rule, not one per client.
   */
  assertSafeResponse(status) {
    assertNotRedirect(status);
    return status;
  }

  /**
   * Perform one request against the device.
   *
   * @param {object} _options { method, path, headers, body, auth, timeoutMs, responseType }
   * @returns {Promise<{ status: number, headers: object, body: Buffer|string }>}
   */
  async request(_options) {
    throw new NotImplementedError(`${this.transportKey}.request`);
  }

  /**
   * Rewrite a media URL so the media gateway can reach the device.
   *
   * Direct and tunnel transports return the URL unchanged (the gateway shares
   * the backend's network view). An agent transport rewrites it to point at the
   * agent's local relay, which is the whole reason this hook exists on the
   * transport rather than in the media service.
   */
  async rewriteMediaUrl(url) {
    return url;
  }

  /** Cheap reachability probe used by health monitoring. */
  async ping() {
    throw new NotImplementedError(`${this.transportKey}.ping`);
  }
}

export default DeviceTransport;
