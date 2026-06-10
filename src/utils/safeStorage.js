const isBrowser = () => typeof window !== "undefined";

export const isQuotaExceededError = (error) =>
  error?.name === "QuotaExceededError" ||
  error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
  error?.code === 22 ||
  error?.code === 1014 ||
  /quota/i.test(String(error?.message || ""));

const serializeValue = (value, options = {}) => {
  if (typeof value === "string") return value;
  if (options.raw === true) return String(value ?? "");
  return JSON.stringify(value);
};

const byteSize = (value) => new Blob([String(value ?? "")]).size;

const warnDev = (message, details = {}) => {
  if (import.meta.env.DEV) {
    console.warn("[safe-storage]", message, details);
  }
};

export const safeSetStorage = (storage, key, value, options = {}) => {
  if (!storage || typeof storage.setItem !== "function") return false;

  const {
    fallbackValue,
    maxBytes,
    trim,
    raw = false,
  } = options;

  const write = (nextValue) => {
    const serialized = serializeValue(nextValue, { raw });
    if (typeof maxBytes === "number" && maxBytes >= 0 && byteSize(serialized) > maxBytes) {
      if (options.debug && import.meta.env.DEV) {
        console.info("[safe-storage:skip-large]", { key, bytes: byteSize(serialized) });
      }
      return false;
    }
    if (options.debug && import.meta.env.DEV) {
      console.info("[safe-storage:write]", { key, bytes: byteSize(serialized) });
    }
    storage.setItem(key, serialized);
    return true;
  };

  try {
    if (write(value)) return true;
    if (typeof trim === "function" && write(trim(value))) return true;
    if (fallbackValue !== undefined && write(fallbackValue)) return true;
    try {
      storage.removeItem?.(key);
    } catch {
      // Ignore cleanup failures.
    }
    return false;
  } catch (error) {
    if (typeof trim === "function") {
      try {
        if (write(trim(value))) return true;
      } catch (retryError) {
        if (!isQuotaExceededError(retryError)) warnDev("storage retry failed", { key, error: retryError });
      }
    }

    if (fallbackValue !== undefined) {
      try {
        if (write(fallbackValue)) return true;
      } catch (fallbackError) {
        if (!isQuotaExceededError(fallbackError)) warnDev("storage fallback failed", { key, error: fallbackError });
      }
    }

    if (!isQuotaExceededError(error)) {
      warnDev("storage write failed", { key, error });
    } else {
      warnDev("storage quota exceeded", { key });
    }

    try {
      storage.removeItem?.(key);
    } catch {
      // Ignore cleanup failures.
    }
    return false;
  }
};

export const safeSetLocalStorage = (key, value, options = {}) => {
  if (!isBrowser()) return false;
  return safeSetStorage(window.localStorage, key, value, options);
};

export const safeSetSessionStorage = (key, value, options = {}) => {
  if (!isBrowser()) return false;
  return safeSetStorage(window.sessionStorage, key, value, options);
};
