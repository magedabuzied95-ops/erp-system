import net from "node:net";

const text = (value = "") => String(value ?? "").trim();
const enabled = (value = "") => ["1", "true", "yes", "on"].includes(text(value).toLowerCase());

const cleanIp = (value = "") => {
  const candidate = text(value).split(",")[0].trim().replace(/^\[|\]$/g, "");
  const withoutMappedPrefix = candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
  return net.isIP(withoutMappedPrefix) ? withoutMappedPrefix : "";
};

// Loopback, private, link-local and CGNAT ranges: an address from these is a proxy or container
// hop in front of the shop, never a shopper.
export const isInternalAddress = (ip = "") => {
  if (!net.isIP(ip)) return true;
  if (net.isIPv6(ip)) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip);
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a === 0;
};

export const resolveTrustedClientIp = (req = {}) => {
  if (enabled(process.env.TRUST_CLOUDFLARE_PROXY)) {
    const cloudflareIp = cleanIp(req.headers?.["cf-connecting-ip"]);
    if (cloudflareIp) return cloudflareIp;
  }
  return cleanIp(req.ip) || cleanIp(req.socket?.remoteAddress);
};

/*
 * The shopper's address for an ad platform's matching (Meta CAPI, TikTok Events API), or "".
 *
 * Without the proxy-trust flags the trusted address is the container hop in front of the API, and
 * Events Manager showed every server event arriving with no usable IP at all. The API is reachable
 * only through Cloudflare, which overwrites CF-Connecting-IP, so that header is read here even when
 * the flag is off. A forged value could only mis-match the forger's own event, so this is fine for
 * matching — and only for matching: rate limits and audit logs keep resolveTrustedClientIp.
 */
export const resolveAdMatchingClientIp = (req = {}) => {
  const candidates = [
    resolveTrustedClientIp(req),
    cleanIp(req.headers?.["cf-connecting-ip"]),
    ...text(req.headers?.["x-forwarded-for"]).split(",").map(cleanIp),
  ];
  return candidates.find((ip) => ip && !isInternalAddress(ip)) || "";
};
