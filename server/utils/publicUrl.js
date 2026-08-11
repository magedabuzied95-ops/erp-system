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

export const getPublicBackendUrl = () =>
  publicOnly(process.env.PUBLIC_BACKEND_URL) ||
  publicOnly(process.env.BACKEND_PUBLIC_URL) ||
  publicOnly(process.env.API_PUBLIC_URL) ||
  publicOnly(process.env.PUBLIC_API_URL) ||
  publicOnly(process.env.VITE_API_URL);

export const getMetaWebhookUrl = () => {
  const publicBackendUrl = getPublicBackendUrl();
  return publicBackendUrl ? `${publicBackendUrl}/api/meta/webhook` : "/api/meta/webhook";
};

export default getPublicAppUrl;
