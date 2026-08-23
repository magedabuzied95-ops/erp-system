/**
 * "The page is showing something worth looking at."
 *
 * This is the gate that off-critical-path work waits on -- today the deferred i18n
 * bundles in src/i18n/i18n.js, which are ~300 KB and used to start while the app
 * was still fetching its own route chunks.
 *
 * It deliberately does NOT mean `load`. In an SPA `load` fires when the entry
 * chunks finish, which on the production storefront was 1.59s -- before a single
 * API request had been issued. Anything scheduled off `load` therefore lands in
 * the middle of the critical path rather than after it.
 *
 * Fired once per page load. Listeners in i18n.js also have an LCP observer and a
 * hard timeout, so a route that never calls this still hydrates; calling it just
 * lets a route that KNOWS it has painted open the gate sooner.
 */

let signalled = false;

/**
 * Announce that meaningful content has been committed to the DOM.
 *
 * Waits two animation frames before dispatching: the first lets React's commit
 * flush, the second lets the browser actually paint it. Dispatching synchronously
 * from a state handler would open the gate while the pixels are still pending,
 * which is the same mistake as using `load`.
 */
export const signalContentPainted = () => {
  if (signalled || typeof window === "undefined") return;
  signalled = true;

  const dispatch = () => {
    try {
      window.dispatchEvent(new Event("m1:content-painted"));
    } catch {
      // A browser without Event construction still has the LCP observer and the
      // timeout ceiling in i18n.js, so losing this signal only costs latency.
    }
  };

  if (typeof window.requestAnimationFrame !== "function") {
    window.setTimeout(dispatch, 0);
    return;
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(dispatch));
};

/** Test seam: lets a suite observe the gate more than once. */
export const resetContentPaintedSignal = () => {
  signalled = false;
};
