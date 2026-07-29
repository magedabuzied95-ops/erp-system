import { buildMetaAdvancedMatching } from "../../../shared/metaEventMatching.js";

const META_PIXEL_ID = import.meta.env.VITE_M1_META_PIXEL_ID || import.meta.env.VITE_META_PIXEL_ID || "2459469681170451";
const ALLOWED_STOREFRONT_HOSTS = new Set([
  "m1store-egy.com",
  "www.m1store-egy.com",
]);

function canTrackMeta() {
  if (!META_PIXEL_ID || typeof window === "undefined") return false;
  return ALLOWED_STOREFRONT_HOSTS.has(window.location.hostname.toLowerCase());
}

const matchingSignature = (matching = {}) => JSON.stringify(matching);

export function initMetaPixel(customer = {}) {
  if (!canTrackMeta()) return false;
  const matching = buildMetaAdvancedMatching(customer);

  if (!window.fbq) {
    ((f, b, e, v, n, t, s) => {
      if (f.fbq) return;

      n = f.fbq = function (...args) {
        n.callMethod ? n.callMethod(...args) : n.queue.push(args);
      };

      if (!f._fbq) f._fbq = n;

      n.push = n;
      n.loaded = true;
      n.version = "2.0";
      n.queue = [];

      t = b.createElement(e);
      t.async = true;
      t.src = v;

      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(
      window,
      document,
      "script",
      "https://connect.facebook.net/en_US/fbevents.js"
    );
  }

  const signature = matchingSignature(matching);
  if (!window.__m1MetaPixelInitialized) {
    window.fbq("init", META_PIXEL_ID, Object.keys(matching).length ? matching : undefined);
    window.__m1MetaPixelInitialized = true;
    window.__m1MetaAdvancedMatchingSignature = signature;
  } else if (Object.keys(matching).length && window.__m1MetaAdvancedMatchingSignature !== signature) {
    window.fbq("init", META_PIXEL_ID, matching);
    window.__m1MetaAdvancedMatchingSignature = signature;
  }
  return true;
}

export function trackMetaPageView() {
  if (!canTrackMeta() || !window.fbq) return;
  window.fbq("track", "PageView");
}
