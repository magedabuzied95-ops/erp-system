// Which deployment is this tab running, and is a newer one live?
//
// Vite stamps the deployed commit into every asset filename
// (`assets/[name]-[hash]-<commit12>.js`, vite.config.js), so the entry <script> of
// this page and the entry <script> of a freshly fetched /index.html name the two
// builds. Same rule as window.__m1Diagnostics and the stale-build recovery in
// index.html.

export const buildIdFromScriptSrc = (src = "") =>
  (String(src || "").match(/-([0-9a-f]{7,12})\.js(?:[?#].*)?$/) || [])[1] || null;

export const buildIdFromHtml = (html = "") => {
  const match = String(html || "").match(/<script[^>]+type="module"[^>]+src="(\/assets\/[^"]+)"/);
  return match ? { build: buildIdFromScriptSrc(match[1]), entry: match[1] } : { build: null, entry: "" };
};

export const currentBuildId = () => {
  if (typeof document === "undefined") return null;
  const scripts = document.querySelectorAll('script[type="module"][src]');
  for (const script of scripts) {
    if (script.src.includes("/assets/")) return buildIdFromScriptSrc(script.src);
  }
  return null;
};

// The deployed build — but only once it is actually bootable: a reload while the
// CDN is still half-propagated is what turns an update into a blank page.
export const fetchLiveBuild = async () => {
  const response = await fetch(`/index.html?__build_check=${Date.now()}`, { cache: "no-store", credentials: "omit" });
  if (!response.ok) return null;
  const { build, entry } = buildIdFromHtml(await response.text());
  if (!build || !entry) return null;
  const script = await fetch(entry, { cache: "no-store", credentials: "omit" }).catch(() => null);
  const type = String(script?.headers?.get("content-type") || "").toLowerCase();
  if (!script?.ok || !type.includes("javascript")) return null;
  return build;
};

export const PORTAL_PATH_PATTERN = /^\/(employee-app|employee-portal|employee\/portal|manager-portal|manager\/)/;
