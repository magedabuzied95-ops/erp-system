// `navigator.serviceWorker.register()` resolves as soon as the REGISTRATION
// exists, not when its worker is running — and `pushManager.subscribe()` against
// a registration whose worker is still installing fails outright with
// "Subscription failed - no active Service Worker".
//
// On a browser that already held the worker this never showed. On a first visit —
// and on every single load while the boot guard was unregistering every worker
// (see index.html) — it meant push silently never subscribed at all, which is
// exactly what the AI Inbox PWA console was reporting on 2026-08-30.
//
// Lives in its own module with no imports so the wait is directly testable.

export const ACTIVATION_TIMEOUT_MS = 10_000;

export const whenWorkerActive = (registration, { timeoutMs = ACTIVATION_TIMEOUT_MS } = {}) =>
  new Promise((resolve) => {
    if (!registration) {
      resolve(null);
      return;
    }
    if (registration.active) {
      resolve(registration);
      return;
    }

    const pending = registration.installing || registration.waiting;
    // No active worker and nothing on its way: waiting cannot change that.
    if (!pending || typeof pending.addEventListener !== "function") {
      resolve(registration.active ? registration : null);
      return;
    }

    let timer = null;
    const settle = (value) => {
      if (timer !== null) clearTimeout(timer);
      pending.removeEventListener?.("statechange", onStateChange);
      resolve(value);
    };
    function onStateChange() {
      if (pending.state === "activated") settle(registration);
      // Redundant means this worker was replaced or discarded — the registration
      // is not going to become usable by waiting on it any longer.
      else if (pending.state === "redundant") settle(registration.active ? registration : null);
    }

    pending.addEventListener("statechange", onStateChange);
    // A worker that never activates must not hang the caller forever; push just
    // stays off for this load and the next one retries.
    timer = setTimeout(() => settle(registration.active ? registration : null), timeoutMs);
  });
