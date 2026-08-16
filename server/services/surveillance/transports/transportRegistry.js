// Surveillance Center — transport registry.
//
// Empty in Phase 1, exactly like the provider registry. No concrete transport
// exists yet, so no code path in this build can open a socket to a device. The
// registry lookup failing with TRANSPORT_UNKNOWN is the intended and only
// outcome until Phase 2 decides how the store network is reached.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/** @type {Map<string, typeof import("./DeviceTransport.js").DeviceTransport>} */
const registry = new Map();

const normalizeKey = (value = "") => String(value ?? "").trim().toLowerCase();

export const registerTransport = (TransportClass) => {
  const key = normalizeKey(TransportClass?.transportKey);
  if (!key) throw new Error("transport must define a static transportKey");
  if (registry.has(key)) throw new Error(`transport "${key}" is already registered`);
  registry.set(key, TransportClass);
  return key;
};

export const hasTransport = (transportKey) => registry.has(normalizeKey(transportKey));

export const getTransportClass = (transportKey) => {
  const TransportClass = registry.get(normalizeKey(transportKey));
  if (!TransportClass) {
    throw new SurveillanceError("no transport registered for this device", {
      code: SURVEILLANCE_ERROR_CODES.TRANSPORT_UNKNOWN,
      status: 400,
      details: { transport: normalizeKey(transportKey) },
    });
  }
  return TransportClass;
};

export const createTransport = (transportKey, options = {}) =>
  new (getTransportClass(transportKey))(options);

export const listTransports = () =>
  [...registry.values()].map((TransportClass) => ({
    transport_key: TransportClass.transportKey,
    display_name: TransportClass.displayName,
  }));

/** Test-only. */
export const __resetTransportRegistry = () => registry.clear();
