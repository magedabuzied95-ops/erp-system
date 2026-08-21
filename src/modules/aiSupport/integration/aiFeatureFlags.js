const FLAG_NAMES = Object.freeze(["AI_ENABLED", "COPILOT_ENABLED", "DECISION_ENABLED", "LEARNING_ENABLED"]);
const DEFAULTS = Object.freeze(Object.fromEntries(FLAG_NAMES.map((name) => [name, false])));
const STORAGE_KEY = "m1:ai-feature-flags";

const parseBoolean = (value) => value === true || String(value).toLowerCase() === "true";
const readStored = () => {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || "{}"); } catch { return {}; }
};

class FeatureFlagService {
  #runtime = {};
  #listeners = new Set();
  #snapshot = DEFAULTS;

  constructor() {
    this.refresh();
    if (typeof window !== "undefined") window.addEventListener("storage", this.refresh);
  }

  refresh = () => {
    const stored = readStored();
    // `import.meta.env` only exists under Vite. The service is constructed at
    // import time, so reading through it unguarded made this module throw the
    // moment anything outside the bundler touched it — a test, a script, a
    // server-side render. Absent env just means "no override", which is what
    // DEFAULTS already says.
    const env = import.meta.env || {};
    const environment = {
      AI_ENABLED: env.VITE_AI_ENABLED,
      COPILOT_ENABLED: env.VITE_COPILOT_ENABLED,
      DECISION_ENABLED: env.VITE_DECISION_ENABLED,
      LEARNING_ENABLED: env.VITE_LEARNING_ENABLED,
    };
    const next = Object.fromEntries(FLAG_NAMES.map((name) => [name, parseBoolean(this.#runtime[name] ?? stored[name] ?? environment[name] ?? DEFAULTS[name])]));
    if (!next.AI_ENABLED) Object.assign(next, { COPILOT_ENABLED: false, DECISION_ENABLED: false, LEARNING_ENABLED: false });
    if (FLAG_NAMES.some((name) => next[name] !== this.#snapshot[name])) {
      this.#snapshot = Object.freeze(next);
      this.#listeners.forEach((listener) => listener());
    }
  };

  setRuntimeConfig = (config = {}) => { this.#runtime = Object.fromEntries(FLAG_NAMES.filter((name) => name in config).map((name) => [name, config[name]])); this.refresh(); };
  setLocal = (name, value) => { if (!FLAG_NAMES.includes(name)) throw new Error(`Unknown feature flag: ${name}`); const stored = readStored(); stored[name] = Boolean(value); localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); this.refresh(); };
  clearRuntimeConfig = () => { this.#runtime = {}; this.refresh(); };
  getSnapshot = () => this.#snapshot;
  subscribe = (listener) => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  dispose = () => { if (typeof window !== "undefined") window.removeEventListener("storage", this.refresh); this.#listeners.clear(); };
}

export const featureFlagService = new FeatureFlagService();
export { FLAG_NAMES, FeatureFlagService };
