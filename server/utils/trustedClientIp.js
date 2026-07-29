import net from "node:net";

const text = (value = "") => String(value ?? "").trim();
const enabled = (value = "") => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

const cleanIp = (value = "") => {
  const candidate = text(value).split(",")[0].trim().replace(/^\[|\]$/g, "");
  const withoutMappedPrefix = candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
  return net.isIP(withoutMappedPrefix) ? withoutMappedPrefix : "";
};

export const resolveTrustedClientIp = (req = {}) => {
  if (enabled(process.env.TRUST_CLOUDFLARE_PROXY)) {
    const cloudflareIp = cleanIp(req.headers?.["cf-connecting-ip"]);
    if (cloudflareIp) return cloudflareIp;
  }
  return cleanIp(req.ip) || cleanIp(req.socket?.remoteAddress);
};
