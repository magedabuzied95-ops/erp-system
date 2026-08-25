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

/* ==========================================================================
   STYLESHEET RECOVERY
   --------------------------------------------------------------------------
   Everything above recovers JavaScript. The stylesheet had no cover at all,
   and it fails in a way that looks nothing like a chunk error.

   The Tailwind bundle enters through a plain <link rel="stylesheet"> that the
   build injects into index.html. When the browser holds a cached 404 for it --
   vercel.json stamps `max-age=31536000, immutable` on /assets/(.*), and that
   header lands on 404 responses too -- the link resolves instantly from cache
   and the page loads "successfully" with no styles. React mounts, every route
   works, and the operator sees raw unstyled HTML: `.flex` computes to
   `display:block`, so images fill the viewport as giant shapes. It reads as a
   crash and is not one, so no error boundary and no chunk handler ever fires.

   isChunkLoadError cannot see this either: it keys on
   `error.target.tagName === "SCRIPT"`, and a stylesheet failure carries
   "LINK". Nor is there always an error event to catch -- a cached 404 can
   still produce a CSSStyleSheet object, just an empty one.

   So the signal is the rule count, not an exception, and the cure is the same
   query-string trick importWithChunkRetry uses on chunks: a different cache
   key goes past the poisoned entry to the origin.

   No reload escalation lives here on purpose. index.html is served `no-store`,
   so the stylesheet name a client asks for always belongs to the deployment it
   just fetched -- "cached as missing" is the failure, and the retry is a
   complete answer to it. A reload would only add a way to loop.
   ========================================================================== */

const STYLESHEET_RETRY_PARAM = "__m1_css";
const STYLESHEET_SETTLE_TIMEOUT_MS = 8000;

const isRecoverableStylesheet = (link) => {
  if (!link || link.tagName !== "LINK") return false;
  if (String(link.rel || "").toLowerCase() !== "stylesheet") return false;

  const href = link.getAttribute("href");
  if (!href) return false;

  try {
    const url = new URL(href, window.location.href);
    return url.origin === window.location.origin
      && url.pathname.startsWith("/assets/")
      && url.pathname.endsWith(".css");
  } catch {
    return false;
  }
};

// Three states, not two: a healthy sheet reports rules, a dead one reports
// zero, and -1 means "cannot judge" -- still loading, or cross-origin, where
// .cssRules throws. Collapsing the last two into "empty" is what would make
// this fire on a Google Fonts link it has no business touching.
const countStylesheetRules = (link) => {
  try {
    return link.sheet ? link.sheet.cssRules.length : -1;
  } catch {
    return -1;
  }
};

const settleStylesheet = (link) => new Promise((resolve) => {
  if (link.sheet) {
    resolve();
    return;
  }

  let settleTimer;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.clearTimeout(settleTimer);
    link.removeEventListener("load", finish);
    link.removeEventListener("error", finish);
    resolve();
  };

  settleTimer = window.setTimeout(finish, STYLESHEET_SETTLE_TIMEOUT_MS);
  link.addEventListener("load", finish);
  link.addEventListener("error", finish);
});

const stylesheetsAttempted = new WeakSet();

const repairStylesheet = async (link) => {
  if (stylesheetsAttempted.has(link)) return false;
  stylesheetsAttempted.add(link);

  let retryUrl;
  try {
    retryUrl = new URL(link.getAttribute("href"), window.location.href);
  } catch {
    return false;
  }
  if (retryUrl.searchParams.has(STYLESHEET_RETRY_PARAM)) return false;
  retryUrl.searchParams.set(STYLESHEET_RETRY_PARAM, String(Date.now()));

  const retry = document.createElement("link");
  retry.rel = "stylesheet";
  retry.setAttribute("data-m1-css-retry", "1");
  if (link.media) retry.media = link.media;
  // Copied as an attribute rather than through the IDL: the build emits a bare
  // `crossorigin`, and round-tripping that through .crossOrigin rewrites it to
  // "anonymous" -- a different request mode, and so a different cache entry
  // than the one being repaired.
  const crossOrigin = link.getAttribute("crossorigin");
  if (crossOrigin !== null) retry.setAttribute("crossorigin", crossOrigin);
  retry.href = retryUrl.toString();

  // Inserted in the dead link's own slot rather than appended. Route CSS is
  // added to <head> at runtime, so a replacement parked at the end would sit
  // after stylesheets it originally preceded and start winning specificity
  // ties it used to lose.
  link.insertAdjacentElement("beforebegin", retry);
  await settleStylesheet(retry);

  if (countStylesheetRules(retry) > 0) {
    link.remove();
    return true;
  }

  // Empty at the origin too, so the file is genuinely empty rather than
  // cached as missing. Leave the original alone -- a second inert link in
  // <head> helps nobody.
  retry.remove();
  return false;
};

const checkStylesheet = async (link) => {
  if (!isRecoverableStylesheet(link)) return false;
  if (link.hasAttribute("data-m1-css-retry")) return false;

  await settleStylesheet(link);
  if (countStylesheetRules(link) !== 0) return false;

  return repairStylesheet(link);
};

export const installStylesheetRecovery = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const check = (link) => { checkStylesheet(link).catch(() => {}); };
  const scan = (root) => {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll("link[rel~=stylesheet][href]").forEach(check);
  };

  scan(document);

  // Route CSS arrives long after boot, and a lazily loaded stylesheet can hold
  // a poisoned 404 exactly like the entry one does.
  const observer = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        if (node.tagName === "LINK") check(node);
        else scan(node);
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => observer.disconnect();
};
