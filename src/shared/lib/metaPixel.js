const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID;

const ALLOWED_STOREFRONT_HOSTS = new Set([
  "m1store-egy.com",
  "www.m1store-egy.com",
]);

function canTrackMeta() {
  if (!META_PIXEL_ID || typeof window === "undefined") return false;
  return ALLOWED_STOREFRONT_HOSTS.has(window.location.hostname.toLowerCase());
}

export function initMetaPixel() {
  if (!canTrackMeta() || window.fbq) return;

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

  window.fbq("init", META_PIXEL_ID);
}

export function trackMetaPageView() {
  if (!canTrackMeta() || !window.fbq) return;
  window.fbq("track", "PageView");
}
