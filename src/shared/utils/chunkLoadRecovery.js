const CHUNK_RELOAD_FLAG = "erp.chunk-reload-attempted";
const CHUNK_RELOAD_GUARD_MS = 5 * 60 * 1000;

const CHUNK_ERROR_PATTERNS = [
  "error loading dynamically imported module",
  "failed to fetch dynamically imported module",
  "loading chunk",
  "importing a module script failed",
];

const getErrorText = (error) => {
  if (!error) return "";
  if (typeof error === "string") return error;

  const reason = error.reason || error.error || error.message || error;
  const parts = [
    error.message,
    error.name,
    error.filename,
    reason?.message,
    reason?.name,
    reason?.stack,
    String(reason || ""),
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
};

export const isChunkLoadError = (error) => {
  const text = getErrorText(error);
  return CHUNK_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
};

export const hasChunkReloadAttempted = () => {
  if (typeof window === "undefined") return false;
  try {
    const value = window.sessionStorage.getItem(CHUNK_RELOAD_FLAG);
    if (!value) return false;
    if (value === "1") return true;

    const timestamp = Number(value);
    return Number.isFinite(timestamp) && Date.now() - timestamp < CHUNK_RELOAD_GUARD_MS;
  } catch {
    return false;
  }
};

const markChunkReloadAttempted = () => {
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()));
  } catch {
    // Ignore restricted storage contexts.
  }
};

const buildCacheBustedUrl = () => {
  const url = new URL(window.location.href);
  url.searchParams.set("__m1_reload", String(Date.now()));
  return url.toString();
};

const clearStaleBuildState = async () => {
  if (typeof window === "undefined") return;

  try {
    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch {
    // Cache storage may be blocked or unavailable.
  }

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {
    // Service workers can be unavailable or blocked.
  }

  const staleBuildKeyPattern = /(build|chunk|asset|manifest|serviceworker|service_worker|sw|vite)/i;
  [window.localStorage, window.sessionStorage].forEach((storage) => {
    if (!storage) return;
    try {
      for (let index = storage.length - 1; index >= 0; index -= 1) {
        const key = storage.key(index);
        if (key && key !== CHUNK_RELOAD_FLAG && staleBuildKeyPattern.test(key)) {
          storage.removeItem(key);
        }
      }
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  });
};

export const forceCleanReload = async () => {
  if (typeof window === "undefined") return false;

  markChunkReloadAttempted();
  await clearStaleBuildState();
  window.location.replace(buildCacheBustedUrl());
  return true;
};

export const recoverFromChunkLoadError = async (error) => {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  if (hasChunkReloadAttempted()) return false;

  await forceCleanReload();
  return true;
};

export const installChunkLoadRecovery = () => {
  if (typeof window === "undefined") return () => undefined;

  const handleError = (event) => {
    const error = event?.error || event;
    if (isChunkLoadError(error) && !hasChunkReloadAttempted()) {
      event?.preventDefault?.();
      recoverFromChunkLoadError(error);
    }
  };

  const handleRejection = (event) => {
    const error = event?.reason || event;
    if (isChunkLoadError(error) && !hasChunkReloadAttempted()) {
      event?.preventDefault?.();
      recoverFromChunkLoadError(error);
    }
  };

  window.addEventListener("error", handleError);
  window.addEventListener("unhandledrejection", handleRejection);

  return () => {
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
};
