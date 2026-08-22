import dns from "node:dns/promises";
import net from "node:net";

/*
 * Link preview (OpenGraph) for chat bubbles. Fetches the page once, reads
 * og:title / og:description / og:image / <title>, caches by URL in memory.
 *
 * SSRF guard: only http(s), hostname must resolve to a public address, no
 * redirects followed into private space (redirects are re-validated), body
 * capped at 512KB, 6s timeout. Failures cache as "no preview" for an hour so
 * a dead link is not re-fetched on every render.
 */
const CACHE = new Map(); // url -> { at, value }
const TTL_MS = 6 * 3600000;
const FAIL_TTL_MS = 3600000;
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const MAX_CACHE = 2000;

const isPrivateIp = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:");
};

const assertPublicUrl = async (value) => {
  let url;
  try { url = new URL(value); } catch { throw new Error("invalid_url"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported_protocol");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("private_host");
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error("private_host"); return url; }
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error("private_host");
  return url;
};

const decode = (text = "") => String(text)
  .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ").trim();

const meta = (html, names) => {
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i"),
    ];
    for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decode(match[1]); }
  }
  return "";
};

const readCapped = async (response) => {
  const reader = response.body?.getReader?.();
  if (!reader) return await response.text();
  const chunks = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
    if (total >= MAX_BYTES) { try { await reader.cancel(); } catch { /* noop */ } break; }
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
};

const fetchFollowing = async (url, hops = 0) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; M1ChatPreview/1.0; +https://m1store-egy.com)", accept: "text/html,application/xhtml+xml" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hops >= MAX_REDIRECTS) throw new Error("too_many_redirects");
      const next = new URL(response.headers.get("location") || "", url);
      await assertPublicUrl(next.href);
      return fetchFollowing(next, hops + 1);
    }
    if (!response.ok) throw new Error(`http_${response.status}`);
    const type = String(response.headers.get("content-type") || "");
    if (!/text\/html|application\/xhtml/i.test(type)) throw new Error("not_html");
    return { html: await readCapped(response), finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
};

export const getLinkPreview = async (rawUrl = "") => {
  const key = String(rawUrl || "").trim().slice(0, 2048);
  if (!key) return null;
  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.at < (cached.value ? TTL_MS : FAIL_TTL_MS)) return cached.value;
  let value = null;
  try {
    const url = await assertPublicUrl(key);
    const { html, finalUrl } = await fetchFollowing(url);
    const title = meta(html, ["og:title", "twitter:title"]) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
    const description = meta(html, ["og:description", "twitter:description", "description"]);
    let image = meta(html, ["og:image", "og:image:url", "twitter:image"]);
    if (image) { try { image = new URL(image, finalUrl).href; await assertPublicUrl(image); } catch { image = ""; } }
    const siteName = meta(html, ["og:site_name"]) || finalUrl.hostname.replace(/^www\./, "");
    if (title || description || image) value = { url: key, title: title.slice(0, 200), description: description.slice(0, 300), image, site_name: siteName.slice(0, 80) };
  } catch {
    value = null;
  }
  if (CACHE.size >= MAX_CACHE) CACHE.delete(CACHE.keys().next().value);
  CACHE.set(key, { at: Date.now(), value });
  return value;
};

export default getLinkPreview;
