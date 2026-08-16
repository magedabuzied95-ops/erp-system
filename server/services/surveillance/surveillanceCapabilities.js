// Surveillance Center — capability model.
//
// THE RULE THIS ENCODES
// ---------------------
// "Do not show the user a control that will fail." Every recorder supports a
// different subset of functions, and the subset depends on the model AND the
// firmware AND sometimes on the permissions of the account we log in with. A
// capability is therefore something we DISCOVER about a specific device, not
// something we assume from a vendor name.
//
// THREE STATES, NOT TWO
// ---------------------
// The temptation is a boolean. A boolean forces every probe failure into one of
// two lies:
//
//   * default true  — the UI shows a PTZ pad for a fixed camera, the user
//                     clicks it, and gets an error. Exactly the "fake control"
//                     the requirements forbid.
//   * default false — a device that genuinely supports storage management is
//                     permanently crippled because one probe timed out on a
//                     busy network, and nothing ever retries.
//
// So the third state is real information:
//
//   supported    — a probe proved it. The control is shown and callable.
//   unsupported  — a probe proved it is absent. The control is hidden.
//   unknown      — we have not proved either. The control is HIDDEN (never
//                  guessed into existence) but the probe is retryable, and the
//                  UI can say "not detected yet" instead of "not supported".
//   read-only    — the data is readable but the device will not accept writes
//                  through the API, or our account lacks the rights. Show the
//                  values, hide the save button.
//
// `unknown` and `unsupported` both hide the control. The distinction is not for
// the gate — it is so an operator can tell "this device can't" from "we didn't
// find out", which are very different bug reports.

import { UnsupportedCapabilityError } from "./surveillanceErrors.js";

export const CAPABILITY_STATES = Object.freeze({
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown",
  READ_ONLY: "read-only",
});

const VALID_STATES = Object.freeze(Object.values(CAPABILITY_STATES));

/**
 * The capability vocabulary.
 *
 * `write` marks a capability that mutates the device — those are the only ones
 * for which "read-only" is meaningful, and they are the ones that need an audit
 * entry and, for some, a step-up confirmation.
 */
export const CAPABILITIES = Object.freeze({
  liveView: { write: false, dangerous: false },
  playback: { write: false, dangerous: false },
  snapshot: { write: false, dangerous: false },
  audio: { write: false, dangerous: false },
  twoWayAudio: { write: true, dangerous: false },
  ptz: { write: true, dangerous: false },
  ptzPresets: { write: true, dangerous: false },

  recordingSettings: { write: true, dangerous: false },
  encoderSettings: { write: true, dangerous: false },
  motionDetection: { write: true, dangerous: false },
  cameraConfiguration: { write: true, dangerous: false },
  timeSettings: { write: true, dangerous: false },

  storageInfo: { write: false, dangerous: false },
  storageManagement: { write: true, dangerous: true },

  networkSettings: { write: true, dangerous: true },
  deviceRestart: { write: true, dangerous: true },
  recordingDeletion: { write: true, dangerous: true },
  firmwareUpdate: { write: true, dangerous: true },
  credentialRotation: { write: true, dangerous: true },
});

export const CAPABILITY_KEYS = Object.freeze(Object.keys(CAPABILITIES));

/** Capabilities that must never run on a single click. Drives the UI modal tier. */
export const DANGEROUS_CAPABILITIES = Object.freeze(
  CAPABILITY_KEYS.filter((key) => CAPABILITIES[key].dangerous),
);

/**
 * A capability set where nothing has been proven.
 *
 * This is what a device looks like the instant it is created and before any
 * probe runs — every control hidden, nothing claimed. It is the only correct
 * starting point: a device row that defaults to `{}` would be indistinguishable
 * from a probe that returned nothing, and `isCapabilityEnabled` would have to
 * guess.
 */
export const unknownCapabilitySet = () =>
  Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, CAPABILITY_STATES.UNKNOWN]));

/**
 * Coerce whatever came back from a probe or out of JSONB into a full, valid set.
 *
 * Unrecognised keys are dropped — a vendor adapter cannot smuggle a capability
 * the UI has no gate for. Missing and invalid values become `unknown`, never
 * `supported`: a corrupted row must not open a control.
 *
 * Booleans are accepted for ergonomics inside adapters (`{ ptz: true }`) since
 * a probe that got a definite answer naturally expresses it that way.
 */
export const normalizeCapabilitySet = (raw = {}) => {
  const source = raw && typeof raw === "object" ? raw : {};
  const out = unknownCapabilitySet();
  for (const key of CAPABILITY_KEYS) {
    const value = source[key];
    if (value === true) out[key] = CAPABILITY_STATES.SUPPORTED;
    else if (value === false) out[key] = CAPABILITY_STATES.UNSUPPORTED;
    else if (typeof value === "string" && VALID_STATES.includes(value)) out[key] = value;
    // anything else stays `unknown`
  }
  return out;
};

export const capabilityState = (capabilities, capability) =>
  normalizeCapabilitySet(capabilities)[capability] ?? CAPABILITY_STATES.UNKNOWN;

/**
 * May the UI show this control, and may the API run it?
 *
 * `unknown` is false. That is the entire point of the three-state model: an
 * undetected capability behaves exactly like an absent one at the gate.
 *
 * @param {"read"|"write"} intent  a read-only capability is usable for reads
 *                                 even when writes are refused
 */
export const isCapabilityEnabled = (capabilities, capability, intent = "write") => {
  const state = capabilityState(capabilities, capability);
  if (state === CAPABILITY_STATES.SUPPORTED) return true;
  if (state === CAPABILITY_STATES.READ_ONLY) return intent === "read";
  return false;
};

/**
 * Enforce a capability server-side.
 *
 * The UI already hides disabled controls, but the UI is a suggestion — a
 * crafted request reaches the route regardless. This is the check that actually
 * counts, and it throws a typed error so the response is
 * "not supported by this model" rather than a 500 from the device library.
 */
export const assertCapability = (capabilities, capability, intent = "write") => {
  if (!CAPABILITY_KEYS.includes(capability)) {
    throw new UnsupportedCapabilityError(capability, CAPABILITY_STATES.UNSUPPORTED);
  }
  if (isCapabilityEnabled(capabilities, capability, intent)) return true;
  throw new UnsupportedCapabilityError(capability, capabilityState(capabilities, capability));
};

/**
 * The shape the API hands the frontend.
 *
 * Includes `dangerous` so the client knows which confirmation tier to use
 * without duplicating the list, and `stale` so it can offer "re-detect" for a
 * probe that is old or never ran.
 */
export const describeCapabilities = (capabilities, { probedAt = null, probeStatus = "" } = {}) => {
  const normalized = normalizeCapabilitySet(capabilities);
  return {
    capabilities: normalized,
    dangerous: DANGEROUS_CAPABILITIES,
    probed_at: probedAt,
    probe_status: probeStatus || (probedAt ? "ok" : "never"),
    unknown_count: Object.values(normalized).filter((state) => state === CAPABILITY_STATES.UNKNOWN).length,
  };
};
