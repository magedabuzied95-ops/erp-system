// Direct HTTP transport — a real socket to a real recorder.
//
// NOT REGISTERED IN THIS BUILD. There is no network path to any device yet, so
// registerSurveillanceTransports() attaches only the mock. This class exists
// finished so that enabling it later is a registration line, not a project.
//
// BUILT ON node:http RATHER THAN fetch
// ------------------------------------
// fetch() takes a URL and resolves the hostname itself, which is precisely what
// must not happen: the guard already resolved and validated an address, and a
// second resolution is a DNS-rebinding window. node:http lets the socket be
// opened to a chosen IP while the original hostname travels only in the Host
// header and the TLS SNI field. It also never follows redirects, which fetch
// does by default — a 302 to 169.254.169.254 would defeat every check that ran
// against the original host.
//
// AUTH
// ----
// Digest challenge-response, retried exactly once against a fresh challenge and
// never again. A retry loop against a recorder walks it straight into its own
// account-lockout threshold, which locks the ERP out of the customer's cameras.

import http from "node:http";
import https from "node:https";

import { DeviceTransport } from "./DeviceTransport.js";
import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";
import { createDigestSession } from "../providers/dahua/dahuaDigestAuth.js";

/** A recorder can send a large snapshot; it cannot send 20 MB of CGI text. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_BYTES = 16 * 1024 * 1024;

export class DirectTransport extends DeviceTransport {
  static transportKey = "direct";
  static displayName = "Direct connection (same network)";

  constructor(options = {}) {
    super(options);
    this.authMethod = "digest";
    this.session = null;
  }

  #sessionFor(credentials) {
    if (!this.session) {
      this.session = createDigestSession({
        username: credentials?.username || "",
        password: credentials?.password || "",
      });
    }
    return this.session;
  }

  #send(destination, { method, path, headers, responseType }) {
    const secure = this.device?.protocol === "https";
    const client = secure ? https : http;
    const limit = responseType === "buffer" ? MAX_BINARY_BYTES : MAX_TEXT_BYTES;

    return new Promise((resolve, reject) => {
      const request = client.request(
        {
          // The PINNED address. Not the hostname — see the header.
          host: destination.address,
          port: destination.port,
          method,
          path,
          headers: {
            // The name the device expects to be called, for virtual hosting and
            // for firmwares that validate it.
            host: `${destination.host}:${destination.port}`,
            connection: "close",
            ...headers,
          },
          // TLS SNI still uses the name; the socket still goes to the IP.
          servername: secure ? destination.host : undefined,
          // Recorders ship self-signed certificates. Refusing them would make
          // https unusable, and the transport is what provides confidentiality
          // here (a tunnel), not the device's certificate.
          rejectUnauthorized: false,
          timeout: this.timeoutMs,
        },
        (response) => {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            size += chunk.length;
            if (size > limit) {
              // Abandon rather than buffer. A device streaming without end must
              // not be able to exhaust the backend's memory.
              response.destroy();
              reject(
                new SurveillanceError("device response exceeded the size limit", {
                  code: SURVEILLANCE_ERROR_CODES.DEVICE_TIMEOUT,
                  status: 502,
                }),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const body = Buffer.concat(chunks);
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: responseType === "buffer" ? body : body.toString("utf8"),
            });
          });
          response.on("error", () => {
            reject(
              new SurveillanceError("device connection failed mid-response", {
                code: SURVEILLANCE_ERROR_CODES.DEVICE_OFFLINE,
                status: 502,
              }),
            );
          });
        },
      );

      request.on("timeout", () => {
        request.destroy();
        reject(
          new SurveillanceError("device did not respond in time", {
            code: SURVEILLANCE_ERROR_CODES.DEVICE_TIMEOUT,
            status: 504,
          }),
        );
      });

      request.on("error", () => {
        // The message is deliberately dropped: it names the address, and an
        // error string is one of the ways an SSRF probe reads its own results.
        reject(
          new SurveillanceError("could not reach device", {
            code: SURVEILLANCE_ERROR_CODES.DEVICE_OFFLINE,
            status: 504,
          }),
        );
      });

      request.end();
    });
  }

  async request({ method = "GET", path = "/", credentials, responseType = "text" } = {}) {
    const destination = await this.resolveDestination();
    const session = this.#sessionFor(credentials);

    // First attempt carries a credential only if we have already been
    // challenged; otherwise it is the probe that earns the challenge.
    const first = await this.#send(destination, {
      method,
      path,
      headers: session.hasChallenge ? { authorization: session.authorize(method, path) } : {},
      responseType,
    });

    // Node does not follow redirects, but a 3xx still means the device wants us
    // somewhere else — which we refuse rather than obey.
    this.assertSafeResponse(first.status);

    if (first.status !== 401) return first;

    const challenge = first.headers["www-authenticate"];
    if (!challenge || !session.accept(Array.isArray(challenge) ? challenge[0] : challenge)) {
      throw new SurveillanceError("device rejected the stored credentials", {
        code: SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED,
        status: 502,
      });
    }

    const second = await this.#send(destination, {
      method,
      path,
      headers: { authorization: session.authorize(method, path) },
      responseType,
    });

    this.assertSafeResponse(second.status);

    // A second 401 after answering a fresh challenge means the password is
    // wrong, not that the nonce was stale. Stop.
    if (second.status === 401) {
      session.reset();
      throw new SurveillanceError("device rejected the stored credentials", {
        code: SURVEILLANCE_ERROR_CODES.DEVICE_UNAUTHORIZED,
        status: 502,
      });
    }

    return second;
  }

  async ping() {
    const startedAt = Date.now();
    const response = await this.request({
      path: "/cgi-bin/magicBox.cgi?action=getDeviceType",
      credentials: this.credentials,
    });
    return { ok: response.status < 400, latencyMs: Date.now() - startedAt };
  }
}

/**
 * Same conversation, different reachability story: the device sits behind a
 * tunnel, so the tenant's allowlist covers the tunnel's routed range rather
 * than a local subnet. Nothing about the HTTP exchange changes — which is the
 * evidence that the provider/transport split is doing its job.
 */
export class TunnelTransport extends DirectTransport {
  static transportKey = "tunnel";
  static displayName = "Secure tunnel to store network";
}

export default DirectTransport;
