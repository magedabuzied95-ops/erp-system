const clean = (value = "") => String(value ?? "").trim().replace(/\/+$/g, "");
const isLocalUrl = (value = "") => /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)(:|\/|$)/i.test(String(value || ""));
const isTemporaryTunnelUrl = (value = "") => /trycloudflare\.com/i.test(String(value || ""));
const publicOnly = (value = "") => {
  const url = clean(value);
  if (!url || isLocalUrl(url) || isTemporaryTunnelUrl(url)) return "";
  return url;
};

export const getPublicAppUrl = () =>
  publicOnly(process.env.STOREFRONT_URL) ||
  publicOnly(process.env.PUBLIC_STOREFRONT_URL) ||
  publicOnly(process.env.VITE_STOREFRONT_URL) ||
  publicOnly(process.env.PUBLIC_APP_URL) ||
  publicOnly(process.env.FRONTEND_URL) ||
  publicOnly(process.env.VITE_PUBLIC_APP_URL);

// The origin this backend was last reached on. Uploaded files are served by the BACKEND and by
// nothing else, so every outbound asset URL needs its origin — and when none of the env names
// below is set, the only other thing that knows it is the traffic arriving at the door. Meta's
// own webhook calls that public host on every message, so this is populated long before any card
// is built. Env always wins; this is the last resort, never an override.
let observedBackendOrigin = "";

export const rememberPublicBackendOrigin = (value = "") => {
  const origin = publicOnly(value);
  if (!origin || !/^https:\/\//i.test(origin)) return observedBackendOrigin;
  observedBackendOrigin = origin;
  return observedBackendOrigin;
};

export const getPublicBackendUrl = () =>
  publicOnly(process.env.PUBLIC_BACKEND_URL) ||
  publicOnly(process.env.BACKEND_PUBLIC_URL) ||
  publicOnly(process.env.API_PUBLIC_URL) ||
  publicOnly(process.env.PUBLIC_API_URL) ||
  publicOnly(process.env.VITE_API_URL) ||
  observedBackendOrigin;

// An /uploads path resolved for somebody OUTSIDE this server — Meta, WhatsApp, an email client.
// It must carry the BACKEND origin: the storefront answers every unknown path with index.html and
// HTTP 200, so an upload pointed at the app origin reaches Meta as 34 KB of HTML where it expected
// a JPEG. Meta then either draws a blank card or refuses the whole template, and a refused template
// is why a colour carousel arrives as one text link per colour. Returning "" when no backend origin
// is known is deliberate: a caller can drop the image, but it must never ship a URL that serves HTML.
export const absolutePublicUploadUrl = (value = "") => {
  const raw = clean(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const backendUrl = getPublicBackendUrl();
  if (!backendUrl) return "";
  return `${backendUrl}/${raw.replace(/^\/+/, "")}`;
};

export const getMetaWebhookUrl = () => {
  const publicBackendUrl = getPublicBackendUrl();
  return publicBackendUrl ? `${publicBackendUrl}/api/meta/webhook` : "/api/meta/webhook";
};

export default getPublicAppUrl;

// The Google review link for the store. It has always lived in ordersController for the invoice
// footer; the delivery WhatsApp message needs the same one, and two copies of a Place ID are two
// chances for a customer to end up reviewing somebody else's shop.
const DEFAULT_GOOGLE_REVIEW_URL = "https://g.page/r/Ccj4YSNAoHbVEAE/review";

export const getGoogleReviewUrl = () =>
  clean(process.env.GOOGLE_REVIEW_URL) || DEFAULT_GOOGLE_REVIEW_URL;
