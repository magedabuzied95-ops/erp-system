/**
 * Hands the first screen over from the cart loader painted by index.html.
 *
 * Call it once the route has something real to show — the homepage when its
 * collections arrive, the product page when the product does. It is idempotent
 * and a no-op when the loader was never painted (ERP routes, a later SPA
 * navigation), so calling it from more than one place is safe.
 */
export function releaseBootLoader() {
  if (typeof window === "undefined") return;
  try {
    window.__m1BootLoader?.release?.();
  } catch {
    // The loader is cosmetic; its own 9s ceiling removes it regardless.
  }
}
