// Surveillance Center — media gateway registry.
//
// Empty in Phase 1. No media server is deployed and none is contacted.
// Phase 3 registers a concrete gateway; until then `getMediaGateway()` throws
// MEDIA_GATEWAY_UNAVAILABLE, which is the correct answer for a build that has
// no media plane.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/** @type {Map<string, typeof import("./MediaGateway.js").MediaGateway>} */
const registry = new Map();

const normalizeKey = (value = "") => String(value ?? "").trim().toLowerCase();

export const registerMediaGateway = (GatewayClass) => {
  const key = normalizeKey(GatewayClass?.gatewayKey);
  if (!key) throw new Error("media gateway must define a static gatewayKey");
  if (registry.has(key)) throw new Error(`media gateway "${key}" is already registered`);
  registry.set(key, GatewayClass);
  return key;
};

export const hasMediaGateway = (gatewayKey) => registry.has(normalizeKey(gatewayKey));

/** Which gateway this deployment uses. Unset means the media plane is off. */
export const configuredGatewayKey = () =>
  normalizeKey(process.env.SURVEILLANCE_MEDIA_GATEWAY || "");

export const getMediaGateway = (gatewayKey = configuredGatewayKey(), options = {}) => {
  const GatewayClass = registry.get(normalizeKey(gatewayKey));
  if (!GatewayClass) {
    throw new SurveillanceError("no media gateway is configured for this deployment", {
      code: SURVEILLANCE_ERROR_CODES.MEDIA_GATEWAY_UNAVAILABLE,
      status: 503,
      details: { gateway: normalizeKey(gatewayKey) },
    });
  }
  return new GatewayClass(options);
};

export const listMediaGateways = () =>
  [...registry.values()].map((GatewayClass) => ({
    gateway_key: GatewayClass.gatewayKey,
    display_name: GatewayClass.displayName,
  }));

/** Test-only. */
export const __resetMediaGatewayRegistry = () => registry.clear();
