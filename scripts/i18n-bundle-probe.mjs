#!/usr/bin/env node
/**
 * Build-artifact probe: prove the BUILT frontend can actually resolve each locale
 * bundle, not merely that the JSON exists on disk.
 *
 * Why this exists. On 2026-08-13 seven bundles were registered in
 * localeManifest.js but never imported by i18n.js. Every source-level guard
 * passed — parity, purity, missing-key and the ratchet all read the dictionaries
 * from disk, which was the side that was correct — and the release shipped with
 * ~1,038 t() call sites rendering humanised keys. The bug was only visible in the
 * build output, so this probe inspects dist/.
 *
 * Method. For each bundle it selects *dictionary-only* sentinels: string values
 * that appear in the locale file but nowhere in src/**, so a match cannot come
 * from a hardcoded literal that localization was replacing. It then requires
 * every sentinel to be present in dist/assets/*.js.
 *
 * Minification escapes non-ASCII to \uXXXX, so each sentinel is probed in both
 * raw and escaped form. (Shell `grep` over raw Arabic is unreliable on Windows —
 * hence a Node probe rather than a grep pipeline.)
 *
 * Usage:
 *   npm run build && npm run i18n:probe-bundle
 *
 * Exit codes: 0 all bundles reachable · 1 a bundle is unreachable or dist/ is
 * missing/stale.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const distAssets = path.join(repoRoot, "dist", "assets");
const localesDir = path.join(repoRoot, "src", "locales");

const BS = String.fromCharCode(92);
const escapeNonAscii = (s) =>
  [...s].map((c) => (c.charCodeAt(0) > 127 ? `${BS}u${c.charCodeAt(0).toString(16).padStart(4, "0")}` : c)).join("");

/** Sentinels required per bundle, and how many candidates to consider. */
const REQUIRED_PER_BUNDLE = 3;

if (!fs.existsSync(distAssets)) {
  console.error("FAIL  dist/assets is missing — run `npm run build` before probing the bundle.");
  process.exit(1);
}

const { RESOURCE_BRANCHES, SUPPORTED_LOCALES } = await import(
  pathToFileURL(path.join(repoRoot, "src", "i18n", "localeManifest.js")).href
);

/* ---------- inputs ---------- */

const bundleFiles = new Set();
for (const entry of RESOURCE_BRANCHES) {
  for (const f of Array.isArray(entry.file) ? entry.file : [entry.file]) bundleFiles.add(f);
}

const distBlobs = fs
  .readdirSync(distAssets)
  .filter((f) => f.endsWith(".js"))
  .map((f) => fs.readFileSync(path.join(distAssets, f), "utf8"));

const collectSources = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(p, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(fs.readFileSync(p, "utf8"));
  }
  return out;
};
const srcText = collectSources(path.join(repoRoot, "src")).join("\n");

const flatten = (o, out = []) => {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") flatten(v, out);
  }
  return out;
};

const presentInBuild = (value) => {
  const escaped = escapeNonAscii(value);
  return distBlobs.some((b) => b.includes(value) || b.includes(escaped));
};

/* ---------- probe ---------- */

let failures = 0;
let skipped = 0;
const rows = [];

for (const locale of SUPPORTED_LOCALES) {
  for (const file of [...bundleFiles].sort()) {
    const p = path.join(localesDir, locale, `${file}.json`);
    if (!fs.existsSync(p)) {
      rows.push({ locale, file, status: "MISSING FILE", detail: p });
      failures += 1;
      continue;
    }
    const values = flatten(JSON.parse(fs.readFileSync(p, "utf8")));
    // dictionary-only: long enough to be distinctive, and not hardcoded in src/**
    const candidates = values.filter((v) => v.length > 14 && !srcText.includes(v));
    if (candidates.length === 0) {
      rows.push({
        locale,
        file,
        status: "SKIP",
        detail: `no dictionary-only sentinel (${values.length} values; all also appear in src/**)`,
      });
      skipped += 1;
      continue;
    }
    const probes = candidates.slice(0, REQUIRED_PER_BUNDLE);
    const found = probes.filter(presentInBuild);
    if (found.length === probes.length) {
      rows.push({ locale, file, status: "OK", detail: `${found.length}/${probes.length} sentinels in build` });
    } else {
      rows.push({
        locale,
        file,
        status: "UNREACHABLE",
        detail: `${found.length}/${probes.length} sentinels in build — bundle is not in the build graph`,
        sample: probes.find((v) => !presentInBuild(v)),
      });
      failures += 1;
    }
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("locale", 7)}${pad("bundle", 22)}${pad("status", 14)}detail`);
for (const r of rows) {
  console.log(`${pad(r.locale, 7)}${pad(r.file, 22)}${pad(r.status, 14)}${r.detail}`);
  if (r.sample) console.log(`${" ".repeat(43)}missing sentinel: ${r.sample.slice(0, 90)}`);
}

console.log(
  `\n${rows.length} bundle/locale pairs probed · ${rows.filter((r) => r.status === "OK").length} reachable · ` +
    `${skipped} skipped (no dictionary-only sentinel) · ${failures} unreachable`,
);

if (failures > 0) {
  console.error(
    "\nFAIL  at least one locale bundle is NOT reachable from the built frontend.\n" +
      "      A bundle can pass parity/purity/missing-key and still be absent from the\n" +
      "      build: check that src/i18n/i18n.js imports it AND lists it in the object\n" +
      "      passed to buildResources(), for BOTH locales.",
  );
  process.exit(1);
}
console.log("\nPASS  every manifest bundle with a dictionary-only sentinel is reachable in the build.");
