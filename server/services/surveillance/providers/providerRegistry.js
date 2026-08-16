// Surveillance Center — provider registry.
//
// The registry is the reason "add a vendor" never means "edit the core". A new
// adapter registers itself here and becomes selectable in the Add Device
// wizard; nothing in the routes, services, schema or UI is touched.
//
// It starts EMPTY on purpose. Phase 1 ships the abstraction with no concrete
// vendor behind it, so there is no code path that can reach a real device yet —
// which is what makes this phase safe to deploy before the network path exists.

import { SURVEILLANCE_ERROR_CODES, SurveillanceError } from "../surveillanceErrors.js";

/** @type {Map<string, typeof import("./SurveillanceProvider.js").SurveillanceProvider>} */
const registry = new Map();

const normalizeKey = (value = "") => String(value ?? "").trim().toLowerCase();

export const registerProvider = (ProviderClass) => {
  const key = normalizeKey(ProviderClass?.vendorKey);
  if (!key) throw new Error("provider must define a static vendorKey");
  if (registry.has(key)) throw new Error(`provider "${key}" is already registered`);
  registry.set(key, ProviderClass);
  return key;
};

export const hasProvider = (vendorKey) => registry.has(normalizeKey(vendorKey));

export const getProviderClass = (vendorKey) => {
  const ProviderClass = registry.get(normalizeKey(vendorKey));
  if (!ProviderClass) {
    throw new SurveillanceError("no provider registered for this vendor", {
      code: SURVEILLANCE_ERROR_CODES.PROVIDER_UNKNOWN,
      status: 400,
      details: { vendor: normalizeKey(vendorKey) },
    });
  }
  return ProviderClass;
};

export const createProvider = (vendorKey, options = {}) => new (getProviderClass(vendorKey))(options);

/** Powers step 1 of the Add Device wizard. Never returns an unregistered vendor. */
export const listProviders = () =>
  [...registry.values()].map((ProviderClass) => ({
    vendor_key: ProviderClass.vendorKey,
    display_name: ProviderClass.displayName,
    default_port: ProviderClass.defaultPort,
  }));

/** Test-only. Keeps registration state from leaking between test files. */
export const __resetProviderRegistry = () => registry.clear();
