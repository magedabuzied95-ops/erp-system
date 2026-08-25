const CHUNK_RELOAD_FLAG = "erp.chunk-reload-attempted";
const CHUNK_RELOAD_GUARD_MS = 5 * 60 * 1000;

const CHUNK_ERROR_PATTERNS = [
  "error loading dynamically imported module",
  "failed to fetch dynamically imported module",
  "failed to load module script",
  "expected a javascript-or-wasm module script",
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
    error.type,
    error.target?.src,
    error.target?.href,
    reason?.message,
    reason?.name,
    reason?.stack,
    String(reason || ""),
  ];

  return parts.filter(Boolean).join(" ").toLowerCase();
};

export const isChunkLoadError = (error) => {
  const text = getErrorText(error);
  const failedScriptSource = String(error?.target?.src || "").toLowerCase();
  const isFailedModuleScript = error?.target?.tagName === "SCRIPT"
    && (failedScriptSource.includes("/assets/") || failedScriptSource.endsWith(".js"));
  return isFailedModuleScript || CHUNK_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
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

export const clearChunkReloadAttempt = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
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

// A recovery the customer sits and watches reads as a crash, whatever the copy
// says. Cache and service-worker teardown gets a budget rather than an
// open-ended await, so a slow or wedged storage layer can never hold the tab on
// the error state longer than the reload itself takes.
const CLEANUP_BUDGET_MS = 1200;

// The sessionStorage guard cannot answer "is a reload already on its way?" --
// it is written the moment one starts, so anything asking afterwards is told a
// reload has been *used up* and concludes nothing can help. An error boundary
// reading it that way paints a failure over a recovery that is seconds from
// landing. This flag is the honest answer, and it lives in memory because a
// reload is exactly what ends its usefulness.
let recoveryInFlight = false;

export const isChunkRecoveryInFlight = () => recoveryInFlight;

export const forceCleanReload = async () => {
  if (typeof window === "undefined") return false;

  recoveryInFlight = true;
  markChunkReloadAttempted();
  await Promise.race([
    clearStaleBuildState(),
    new Promise((resolve) => { window.setTimeout(resolve, CLEANUP_BUDGET_MS); }),
  ]);
  window.location.replace(buildCacheBustedUrl());
  return true;
};

export const recoverFromChunkLoadError = async (error) => {
  if (typeof window === "undefined" || !isChunkLoadError(error)) return false;
  if (hasChunkReloadAttempted()) return false;

  await forceCleanReload();
  return true;
};

// Both Vite and rolldown name the chunk in the rejection text ("Failed to fetch
// dynamically imported module: <url>"), and a failed <script> carries it on the
// event target. That URL is what makes a targeted retry possible at all.
const CHUNK_URL_PATTERN = /https?:\/\/[^\s"'()]+?\.m?js(?:\?[^\s"'()]*)?/i;

export const extractChunkUrl = (error) => {
  const fromTarget = String(error?.target?.src || "");
  if (fromTarget) return fromTarget;

  const text = [
    error?.message,
    error?.reason?.message,
    String(error?.reason || ""),
  ].filter(Boolean).join(" ");

  const match = text.match(CHUNK_URL_PATTERN);
  return match ? match[0] : "";
};

/**
 * A chunk that 404s is not always a chunk that is gone.
 *
 * vercel.json stamps every /assets/* response with `max-age=31536000,
 * immutable`, and that header lands on 404s too -- so the CDN in front of the
 * app stores "this chunk does not exist" and keeps serving it from that edge
 * long after the file is healthy. One 404 served inside a deploy window becomes
 * a lasting one for everybody routed through that edge.
 *
 * A query string is a different cache key, so re-importing the SAME chunk with
 * one goes past the poisoned entry to the origin and succeeds. The customer
 * sees nothing at all. Only if the retry fails too is the chunk genuinely gone
 * -- a newer deployment replaced it -- and a reload is the only way back.
 */
export const importWithChunkRetry = (load) => load().catch(async (error) => {
  if (typeof window === "undefined" || !isChunkLoadError(error)) throw error;

  const url = extractChunkUrl(error);
  if (url) {
    try {
      const retryUrl = new URL(url, window.location.href);
      retryUrl.searchParams.set("__m1_chunk", String(Date.now()));
      return await import(/* @vite-ignore */ retryUrl.toString());
    } catch {
      // Genuinely missing rather than merely cached as missing -- fall through
      // to the reload, which is the only thing left that can work.
    }
  }

  await recoverFromChunkLoadError(error);
  throw error;
});

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
  const healthyBootTimer = window.setTimeout(() => {
    clearChunkReloadAttempt();
  }, 10_000);

  return () => {
    window.clearTimeout(healthyBootTimer);
    window.removeEventListener("error", handleError);
    window.removeEventListener("unhandledrejection", handleRejection);
  };
};
