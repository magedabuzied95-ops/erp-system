/**
 * Storefront copy inventory.
 *
 * The storefront is deliberately excluded from the i18n scanners (see
 * scripts/i18n-scan.mjs), so nobody has ever had a list of what the site
 * actually says. Its copy lives in three shapes, and this walks all three:
 *
 *   1. `isRtl ? "عربي" : "English"` — a bilingual pair written inline. These are
 *      the ones that can silently drift apart, because nothing checks them.
 *   2. `t("storefront.x")` / `sfText("storefront.x", "fallback")` — keys that
 *      resolve through src/locales/{ar,en}/*.json like the rest of the product.
 *   3. A bare Arabic or English string literal with no counterpart at all —
 *      the same sentence for every reader, whatever language they chose.
 *
 * Output: a table on stdout, and `--json <path>` for the machine-readable form.
 * Counting only; it changes nothing.
 *
 *   node scripts/storefront-copy-inventory.mjs
 *   node scripts/storefront-copy-inventory.mjs --json tmp/copy.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["src/storefront"];
const EXTENSIONS = new Set([".js", ".jsx"]);

const ARABIC = /[؀-ۿ]/;
// A string worth calling copy: has a letter, is not a class list, a path, an
// import specifier, a CSS value or a machine key.
const LOOKS_LIKE_CODE =
  /^(?:[a-z-]+:|\/|\.\.?\/|#|https?:|data:|[a-z0-9_.-]+\.(?:js|jsx|css|png|jpg|svg|webp|mp4)$)|^[a-z0-9_-]+$|^[\d\s.,%+-]+$/i;
const CSS_ISH = /(?:^|\s)(?:flex|grid|hidden|block|inline|absolute|relative|rounded|border|bg-|text-|px-|py-|mt-|mb-|gap-|w-|h-)/;

const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
};

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

// A storefront file is mostly not copy: it is class lists, CSS values, media
// queries, module paths and the normalized lookup tables product names are
// matched against. Each of these was a false positive on the first run, and a
// list that is 40% CSS is a list nobody reads.
const NOT_COPY = [
  /\b(?:rgba?|hsla?|linear-gradient|radial-gradient|repeating-linear-gradient|scale|translate3d|translate|rotate|cubic-bezier|drop-shadow|blur|calc|var|url|env|clamp|minmax)\(/,
  /#[0-9a-f]{3,8}\b/i, // a colour, or an anchor
  /^\(?(?:prefers-|min-width|max-width|hover:|orientation)/, // media queries
  /^\[|\]$/, // attribute selectors
  /^[a-z0-9@._-]+\/[a-z0-9@._/-]+$/i, // module specifiers, "react-icons/fa"
  /^[\w-]+(?:\s*,\s*[\w-]+)+$/, // CSS property lists, "transform, opacity"
  /^\d+(?:px|rem|em|vh|vw|%|s|ms)\b/, // dimensions
];

const isCopy = (value) => {
  const text = String(value || "").trim();
  if (text.length < 2 || text.length > 400) return false;
  if (!/[A-Za-z؀-ۿ]/.test(text)) return false;
  if (LOOKS_LIKE_CODE.test(text)) return false;
  if (CSS_ISH.test(text)) return false;
  // A dotted machine key ("storefront.header.menu"), not a sentence.
  if (/^[a-z][\w]*(\.[\w]+)+$/i.test(text)) return false;
  if (NOT_COPY.some((pattern) => pattern.test(text))) return false;
  // A single lowercase Latin token is a value, not a sentence. Arabic is kept
  // at any length: "أخرى" is a real label.
  if (!/\s/.test(text) && /^[a-z][a-z0-9_-]*$/.test(text)) return false;
  return true;
};

const results = { pairs: [], keys: [], singles: [] };
const files = ROOTS.flatMap((dir) => walk(path.join(root, dir)));

// `cond ? "A" : "B"` where at least one side is real copy. Quotes are matched
// non-greedily and escaped quotes are allowed inside.
const PAIR = /\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const KEY = /\b(?:t|sfText)\(\s*"([^"]+)"(?:\s*,\s*"((?:[^"\\]|\\.)*)")?/g;
const STRING = /"((?:[^"\\\n]|\\.)*)"/g;

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const relative = path.relative(root, file).replace(/\\/g, "/");
  const claimed = new Set();

  for (const match of source.matchAll(PAIR)) {
    const [whole, a, b] = match;
    if (!isCopy(a) && !isCopy(b)) continue;
    const arabicFirst = ARABIC.test(a);
    results.pairs.push({
      file: relative,
      line: lineOf(source, match.index),
      ar: arabicFirst ? a : b,
      en: arabicFirst ? b : a,
    });
    claimed.add(whole);
    for (const value of [a, b]) claimed.add(`"${value}"`);
  }

  for (const match of source.matchAll(KEY)) {
    const [whole, key, fallback] = match;
    if (!key.includes(".")) continue;
    results.keys.push({ file: relative, line: lineOf(source, match.index), key, fallback: fallback || "" });
    claimed.add(whole);
    if (fallback) claimed.add(`"${fallback}"`);
  }

  for (const match of source.matchAll(STRING)) {
    const [whole, value] = match;
    if (claimed.has(whole) || !isCopy(value)) continue;
    // Skip anything sitting inside a className / import / URL context.
    const before = source.slice(Math.max(0, match.index - 40), match.index);
    if (/(?:className|class|import|from|url|src|href|to|id|key|name|type|role|data-[\w-]+)\s*[=:(]\s*$/.test(before)) continue;
    results.singles.push({
      file: relative,
      line: lineOf(source, match.index),
      text: value,
      script: ARABIC.test(value) ? "ar" : "en",
    });
  }
}

// A line carrying four or more strings is a lookup table, not a sentence the
// site shows — the category synonym lists ("شنطة", "شنطتي", "حقائب", …) that
// product search matches against all sit on one line each. Flagged rather than
// dropped: the judgement belongs to whoever reads the report.
const density = {};
results.singles.forEach((row) => {
  const key = `${row.file}:${row.line}`;
  density[key] = (density[key] || 0) + 1;
});
results.singles.forEach((row) => {
  row.likelyLookup = density[`${row.file}:${row.line}`] >= 4;
});

/* ------------------------------------------------- resolve the keys to text */

// The 719 keys are already bilingual — they resolve through the locale files
// like the rest of the product. Reading their values here is what turns a list
// of key names into a list of what the site actually says.
const localeRoot = path.join(root, "src/locales");

// Deep, not Object.assign: several bundles declare a top-level `common` branch,
// and a shallow merge lets the last file read wipe the real one — which is
// exactly why `common.loading` first reported as missing when it is right there
// in common.json.
const deepMerge = (target, source) => {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = deepMerge(target[key] && typeof target[key] === "object" ? target[key] : {}, value);
    } else {
      target[key] = value;
    }
  }
  return target;
};

const dictionaries = {};
for (const locale of ["ar", "en"]) {
  const merged = {};
  const dir = path.join(localeRoot, locale);
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const contents = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    // storefront.json holds the `storefront.*` branch; the rest are top-level.
    deepMerge(merged, file === "storefront.json" ? { storefront: contents } : contents);
  }
  dictionaries[locale] = merged;
}

const lookup = (dictionary, key) =>
  key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), dictionary);

results.keys.forEach((row) => {
  const ar = lookup(dictionaries.ar, row.key);
  const en = lookup(dictionaries.en, row.key);
  row.ar = typeof ar === "string" ? ar : "";
  row.en = typeof en === "string" ? en : "";
  row.missing = !row.ar || !row.en;
});

const unresolved = results.keys.filter((row) => row.missing);

const jsonFlag = process.argv.indexOf("--json");
if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
  const out = path.resolve(root, process.argv[jsonFlag + 1]);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  console.log(`wrote ${path.relative(root, out)}`);
}

const byFile = (rows) => {
  const counts = {};
  rows.forEach((row) => {
    counts[row.file] = (counts[row.file] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
};

console.log(`files scanned: ${files.length}`);
console.log(`\nbilingual pairs written inline: ${results.pairs.length}`);
byFile(results.pairs).slice(0, 10).forEach(([file, count]) => console.log(`  ${String(count).padStart(4)}  ${file}`));

console.log(`\ntranslation keys: ${results.keys.length} (${new Set(results.keys.map((k) => k.key)).size} unique)`);
byFile(results.keys).slice(0, 10).forEach(([file, count]) => console.log(`  ${String(count).padStart(4)}  ${file}`));

const arabicSingles = results.singles.filter((row) => row.script === "ar");
const latinSingles = results.singles.filter((row) => row.script === "en");
console.log(`\nsingle-language literals: ${results.singles.length}  (Arabic ${arabicSingles.length}, Latin ${latinSingles.length})`);
byFile(results.singles).slice(0, 10).forEach(([file, count]) => console.log(`  ${String(count).padStart(4)}  ${file}`));

const lookupRows = results.singles.filter((row) => row.likelyLookup);
console.log(`  of those, ${lookupRows.length} sit on a line with 4+ strings and are probably lookup tables, not copy`);

console.log(`\nkeys that do not resolve in both locales: ${unresolved.length}`);
unresolved.slice(0, 10).forEach((row) => console.log(`  ${row.key}  (ar:${row.ar ? "y" : "n"} en:${row.en ? "y" : "n"})  ${row.file}:${row.line}`));

console.log(`\ntotal strings the site can show: ${results.pairs.length * 2 + results.keys.length + results.singles.length}`);
