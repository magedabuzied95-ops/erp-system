/**
 * Extracts every literal translation key used in the frontend and resolves it
 * against the composed dictionaries.
 *
 * Only literal single-argument keys are collected. Dynamic keys (template
 * literals, concatenations, computed branch names) are out of reach for a static
 * scan and are reported separately so the count stays honest.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const REPO_ROOT = process.cwd();

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

/**
 * `t("branch.path")` and `t("branch.path", "default")`. The optional second
 * argument is a fallback string and does not change key resolution.
 */
const T_CALL_RE = /(?:^|[^\w$.])(?:i18n\.)?t\(\s*"([A-Za-z][\w-]*(?:\.[\w-]+)+)"/g;
/** Keys built at runtime, e.g. t(`orders.status.${value}`). */
const DYNAMIC_T_CALL_RE = /(?:^|[^\w$.])(?:i18n\.)?t\(\s*`/g;

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

export const collectUsedKeys = async () => {
  const files = walk(path.join(REPO_ROOT, "src"));
  const used = new Map();
  let dynamic = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    for (const match of text.matchAll(T_CALL_RE)) {
      const key = match[1];
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(relative);
    }
    dynamic += [...text.matchAll(DYNAMIC_T_CALL_RE)].length;
  }
  return { used, dynamic, files: files.length };
};

export const loadDictionaryKeys = async () => {
  const manifestUrl = pathToFileURL(path.join(REPO_ROOT, "src", "i18n", "localeManifest.js")).href;
  const { SUPPORTED_LOCALES, RESOURCE_BRANCHES, resolveBranch } = await import(manifestUrl);
  const localesDir = path.join(REPO_ROOT, "src", "locales");

  const flatten = (value, prefix, out) => {
    if (typeof value === "string") return out.add(prefix);
    if (Array.isArray(value)) {
      value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
      return out;
    }
    if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  };

  const perLocale = {};
  for (const locale of SUPPORTED_LOCALES) {
    const files = {};
    for (const entry of fs.readdirSync(path.join(localesDir, locale))) {
      if (!entry.endsWith(".json")) continue;
      files[entry.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(localesDir, locale, entry), "utf8"));
    }
    const keys = new Set();
    for (const entry of RESOURCE_BRANCHES) flatten(resolveBranch(entry, files), entry.branch, keys);
    perLocale[locale] = keys;
  }
  return perLocale;
};

/**
 * A key resolves if it is a leaf, or if it names a subtree (i18next returnObjects
 * style access and `t("a.b")` where "a.b.c" exists both appear in this codebase).
 */
export const resolves = (key, keySet) => {
  if (keySet.has(key)) return true;
  // Subtree access: t("a.b") where the dictionary holds "a.b.c", and array
  // access: t("a.b") where the dictionary holds "a.b[0]".
  for (const candidate of keySet) {
    if (candidate.startsWith(`${key}.`) || candidate.startsWith(`${key}[`)) return true;
  }
  return false;
};

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const { used, dynamic, files } = await collectUsedKeys();
  const dictionaries = await loadDictionaryKeys();
  const missing = [];
  for (const [key, usedIn] of used) {
    const absentIn = Object.keys(dictionaries).filter((locale) => !resolves(key, dictionaries[locale]));
    if (absentIn.length) missing.push({ key, absentIn, usedIn: [...usedIn] });
  }
  console.log(`files=${files} literalKeys=${used.size} dynamicKeyCalls=${dynamic} unresolved=${missing.length}`);
  for (const item of missing.slice(0, 400)) {
    console.log(`- ${item.key} [missing in ${item.absentIn.join(",")}] ${item.usedIn[0]}`);
  }
}
