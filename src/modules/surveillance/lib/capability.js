// Capability gating for the UI.
//
// FOUR STATES, AND ONLY ONE OF THEM EARNS A CONTROL
// -------------------------------------------------
//   supported    the probe confirmed it works        -> show the control
//   read-only    it can be read but not written      -> show the value, no edit
//   unsupported  the device answered "no"            -> hide the control
//   unknown      the probe could not determine it    -> HIDE the control
//
// `unknown` hiding rather than disabling is the decision that matters. A
// disabled button is a promise that it might work later; the reference XVR
// answers the PTZ status call with an error, so a greyed-out PTZ pad would be a
// permanent invitation to keep pressing something that cannot work. And a
// control that is enabled on `unknown` is worse still — it fails at the click,
// against a real device, in front of a customer.

export const CAPABILITY_STATES = Object.freeze({
  SUPPORTED: "supported",
  UNSUPPORTED: "unsupported",
  UNKNOWN: "unknown",
  READ_ONLY: "read-only",
});

/**
 * Normalise whatever the API returned for one capability.
 *
 * Accepts the flat string form the server sends (`{ ptz: "unsupported" }`) and
 * the object form an older shape used (`{ ptz: { state: "..." } }`), because
 * being wrong here silently enables a dangerous control.
 */
export const capabilityState = (capabilities, key) => {
  const raw = capabilities?.[key];
  if (raw === undefined || raw === null) return CAPABILITY_STATES.UNKNOWN;
  if (typeof raw === "object") return raw.state || CAPABILITY_STATES.UNKNOWN;
  if (raw === true) return CAPABILITY_STATES.SUPPORTED;
  if (raw === false) return CAPABILITY_STATES.UNSUPPORTED;
  return String(raw);
};

/** May the operator SEE this data? Read-only counts. */
export const canRead = (capabilities, key) => {
  const state = capabilityState(capabilities, key);
  return state === CAPABILITY_STATES.SUPPORTED || state === CAPABILITY_STATES.READ_ONLY;
};

/**
 * May the operator CHANGE this?
 *
 * Only an explicit `supported`. Everything else — including `unknown` — is a
 * no, and the caller must hide rather than disable.
 */
export const canWrite = (capabilities, key) =>
  capabilityState(capabilities, key) === CAPABILITY_STATES.SUPPORTED;

/** i18n key explaining why a control is absent. */
export const absenceReasonKey = (capabilities, key) => {
  switch (capabilityState(capabilities, key)) {
    case CAPABILITY_STATES.UNSUPPORTED: return "surveillance.capability.unsupported";
    case CAPABILITY_STATES.READ_ONLY: return "surveillance.capability.readOnly";
    case CAPABILITY_STATES.UNKNOWN: return "surveillance.capability.unknown";
    default: return "surveillance.capability.unknown";
  }
};
