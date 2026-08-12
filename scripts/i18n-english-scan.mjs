/**
 * English-side scanner.
 *
 * The original scanner is Arabic-biased: it reliably finds Arabic literals, but a
 * hardcoded ENGLISH literal leaks English into Arabic mode just as badly. This
 * module finds user-visible English-only literals and classifies them, because
 * most English literals in a React codebase are NOT user-visible text.
 *
 * A finding is only "broken chrome" when it is English prose sitting in a slot
 * that renders to the user. Everything else is bucketed with a reason.
 */
import fs from "node:fs";
import path from "node:path";

import { walkSourceFiles, scanFile, REPO_ROOT } from "./i18n-scan.mjs";

const ARABIC = /[؀-ۿ]/;

/**
 * Identifiers, formats, units, currencies and providers that are correct in
 * Arabic UI. Kept deliberately broad: a false negative costs one untranslated
 * word, a false positive corrupts a SKU or an enum.
 */
const TECHNICAL = new Set([
  "sku", "pos", "erp", "qr", "id", "url", "api", "csv", "pdf", "xlsx", "xls", "png", "jpg", "jpeg", "svg", "webp",
  "html", "json", "xml", "zip", "a4", "a5", "gtin", "ean", "upc", "imei", "iban", "otp", "sms", "pin", "cvv", "vat",
  "egp", "usd", "sar", "aed", "eur", "gbp", "kpi", "roi", "aov", "ltv", "cogs", "crm", "hr", "it", "ui", "ux", "cta",
  "seo", "slug", "uuid", "jwt", "http", "https", "ip", "db", "sql", "ms", "kb", "mb", "gb", "px", "rgb", "hex",
  "ai", "gpt", "llm", "ocr", "gps", "pwa", "swr", "dom", "css", "js", "ttf", "woff", "n/a", "ok", "id:", "vapid",
]);

const BRANDS = new Set([
  "whatsapp", "facebook", "messenger", "instagram", "meta", "google", "tiktok", "cloudinary", "vercel",
  // shipping carriers, same class as one another
  "bosta", "mylerz", "shipblu",
  "paymob", "fawry", "instapay", "visa", "mastercard", "shopify", "gmail", "youtube", "twitter", "snapchat",
  "nike", "adidas", "crocs", "puma", "new balance", "air jordan", "jordan", "m1", "m1 store", "mirror",
  "vodafone", "vodafone cash", "etisalat", "orange", "telegram", "render", "postgres", "redis", "node",
]);

/** Slots whose value is a machine value, never rendered prose. */
const NON_UI_ATTRIBUTES = /^(type|name|id|href|to|src|value|key|role|method|target|rel|for|accept|autoComplete|inputMode|enterKeyHint|data-testid)$/;

/**
 * Files whose English literals are LOOKUP IDENTIFIERS, not rendered text. Each
 * needs a proof that the identifier resolves to a translated label.
 */
const IDENTIFIER_FILES = new Map([
  [
    "src/modules/permissions/lib/rbacStore.js",
    "Nav labels are lookup ids resolved via src/i18n/navigation.js; tests/i18n-navigation-guard.test.js proves each maps to a key that resolves in both locales.",
  ],
]);

/** Files whose English is print/export copy rather than app chrome. */
const PRINT_MARKERS = /invoicePdf|barcodeLabels|ProductPrintList|thermalReceipt|printLocalization|Export\.js|analyticsExport|employeeAnalyticsExport/;
const PROTOTYPE_MARKERS = /ComponentsPreview|DashboardPrototype|ThemeFoundation|AppShellPreview/;
const AI_CONTENT_MARKERS = /aiSupport|AiInbox|aiStudio|copilot|intelligence/;
const DEBUG_MARKERS = /console\.|logger|debug/i;

const looksLikeProse = (value) => {
  const clean = value.trim();
  if (clean.length < 3) return false;
  if (!/[A-Za-z]/.test(clean)) return false;
  if (ARABIC.test(clean)) return false; // bilingual/mixed handled elsewhere
  if (TECHNICAL.has(clean.toLowerCase())) return false;
  if (BRANDS.has(clean.toLowerCase())) return false;
  if (/^[A-Z0-9_]+$/.test(clean)) return false;                 // SCREAMING_ENUM
  if (/^[a-z0-9]+([_-][a-z0-9]+)+$/.test(clean)) return false;  // snake/kebab machine value
  if (/^[a-z][a-zA-Z0-9]*$/.test(clean)) return false;          // camelCase identifier
  if (/^[\d\s.,:/+()%-]+$/.test(clean)) return false;
  if (/^(https?:|\/|#|data:|mailto:|tel:)/i.test(clean)) return false;
  if (/\.(js|jsx|ts|tsx|css|json|png|jpg|svg)$/i.test(clean)) return false;
  // Real prose has a space, or is a single capitalised word like "Save".
  return clean.includes(" ") || /^[A-Z][a-z]{2,}$/.test(clean);
};

/** 1-indexed line number of a character offset. */
const lineAt = (text, index) => text.slice(0, index).split("\n").length;

/* ------------------------------------------------------------------ *
 * Minimal source-aware skipper.
 *
 * Brace matching that just counts `{` and `}` is wrong in this codebase: a
 * single JSX file is full of braces inside strings, template literals and
 * `${...}` interpolation. An earlier attempt at the bilingual-ternary shape
 * used naive counting, misaligned, and was reverted rather than shipped.
 * These helpers step over strings, templates (recursively, through nested
 * interpolation) and comments so the brace depth is real.
 * ------------------------------------------------------------------ */

/** Index just past the closing quote of the string starting at `i`. */
const skipString = (text, i) => {
  const quote = text[i];
  i += 1;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return i;
};

/** Index just past the closing backtick, descending into every `${...}`. */
const skipTemplate = (text, i) => {
  i += 1;
  while (i < text.length) {
    if (text[i] === "\\") { i += 2; continue; }
    if (text[i] === "`") return i + 1;
    if (text[i] === "$" && text[i + 1] === "{") { i = skipBraces(text, i + 1); continue; }
    i += 1;
  }
  return i;
};

/** Index just past the `}` matching the `{` at `i`. */
function skipBraces(text, i) {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = skipString(text, i); continue; }
    if (c === "`") { i = skipTemplate(text, i); continue; }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") { depth -= 1; if (depth === 0) return i + 1; }
    i += 1;
  }
  return i;
}

/** Top-level keys of the object literal spanning [start, end). */
const objectKeys = (text, start, end) => {
  const keys = new Set();
  let i = start + 1;
  let depth = 0;
  while (i < end - 1) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const close = skipString(text, i);
      if (depth === 0) {
        const raw = text.slice(i + 1, close - 1);
        let j = close;
        while (j < end && /\s/.test(text[j])) j += 1;
        if (text[j] === ":") keys.add(raw);
      }
      i = close;
      continue;
    }
    if (c === "`") { i = skipTemplate(text, i); continue; }
    if (c === "{" || c === "[" || c === "(") { depth += 1; i += 1; continue; }
    if (c === "}" || c === "]" || c === ")") { depth -= 1; i += 1; continue; }
    if (depth === 0 && /[A-Za-z_$]/.test(c)) {
      let j = i;
      while (j < end && /[\w$]/.test(text[j])) j += 1;
      const word = text.slice(i, j);
      let k = j;
      while (k < end && /\s/.test(text[k])) k += 1;
      if (text[k] === ":") keys.add(word);
      i = j;
      continue;
    }
    i += 1;
  }
  return keys;
};

/**
 * Arabic test that also sees `مر...` escapes. POSPro (and other files
 * that have been through a codemod) store their Arabic escaped, so a raw
 * character-class test reports the branch as English and the pair is missed.
 */
const containsArabic = (source) =>
  ARABIC.test(source) ||
  ARABIC.test(source.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));

/** Does the expression governing this ternary select on language? */
const LANGUAGE_CONDITION =
  /\b(isArabic|isAr|isRtl|isRTL|lang|language|locale|currentLanguage|dir)\b|["']ar["']/;

/**
 * Line ranges of the ENGLISH branch of a bilingual copy ternary:
 *
 *   const copy = (language) => isAr
 *     ? { title: "...عربى", subtitle: "..." }
 *     : { title: "English",  subtitle: "..." };
 *
 * Requires ALL of:
 *   - the condition selects on language,
 *   - both branches are object literals,
 *   - exactly one branch carries Arabic,
 *   - the branches are demonstrably PARALLEL - at least two shared top-level
 *     keys and >= 60% key overlap.
 * Anything less is left as debt.
 */
export const bilingualTernaryRanges = (text, half = "en") => {
  const ranges = [];
  // Candidates are located with a regex rather than by walking every character:
  // a char walk has to guess whether a quote opens a string, and JSX prose is
  // full of apostrophes ("don't"), which swallowed whole regions. The
  // source-aware matcher is still used for the structural part below, where it
  // starts at a real `{` in code.
  const CANDIDATE = /\?\s*\{/g;
  let match;
  while ((match = CANDIDATE.exec(text))) {
    const i = match.index;
    if (text[i + 1] === "." || text[i + 1] === "?") continue; // ?. and ??

    const a = text.indexOf("{", i);
    const aEnd = skipBraces(text, a);

    let mid = aEnd;
    while (mid < text.length && /\s/.test(text[mid])) mid += 1;
    if (text[mid] !== ":") continue;
    let b = mid + 1;
    while (b < text.length && /\s/.test(text[b])) b += 1;
    if (text[b] !== "{") continue;
    const bEnd = skipBraces(text, b);

    if (!LANGUAGE_CONDITION.test(text.slice(Math.max(0, i - 160), i))) continue;

    const aSrc = text.slice(a, aEnd);
    const bSrc = text.slice(b, bEnd);
    const aAr = containsArabic(aSrc);
    const bAr = containsArabic(bSrc);
    if (aAr === bAr) continue;

    const aKeys = objectKeys(text, a, aEnd);
    const bKeys = objectKeys(text, b, bEnd);
    const shared = [...aKeys].filter((k) => bKeys.has(k)).length;
    const widest = Math.max(aKeys.size, bKeys.size);
    if (shared < 2 || !widest || shared / widest < 0.6) continue;

    const wantArabic = half === "ar";
    const [from, to] = aAr === wantArabic ? [a, aEnd] : [b, bEnd];
    ranges.push([lineAt(text, from), lineAt(text, to)]);
    CANDIDATE.lastIndex = bEnd;
  }
  return ranges;
};

/**
 * Line ranges of the `en:` half of a WORKING BILINGUAL sibling table:
 *
 *   const labels = { ar: { title: "..." }, en: { title: "..." } };
 *
 * English inside such a block is not a leak - it is the English half of a
 * structure that already renders correctly in both languages.
 *
 * The test is structural and deliberately narrow: an `en:` (or `english:`) key
 * opening an object, which has a SIBLING `ar:` key at the SAME indentation
 * inside the SAME enclosing block. A file that merely happens to contain Arabic
 * somewhere is not excluded.
 */
export const bilingualHalfRanges = (text, half = "en") => {
  const lines = text.split("\n");
  const ranges = [];
  const EN_KEY = /^(\s*)(?:"|')?(en|english)(?:"|')?\s*:\s*\{/;
  const AR_KEY = /^(\s*)(?:"|')?(ar|arabic)(?:"|')?\s*:\s*\{/;
  const KEY = half === "ar" ? AR_KEY : EN_KEY;
  const SIBLING = half === "ar" ? EN_KEY : AR_KEY;

  for (let i = 0; i < lines.length; i += 1) {
    const open = KEY.exec(lines[i]);
    if (!open) continue;
    const indent = open[1].length;

    // Look for the `ar:` sibling at identical indentation, without leaving the
    // enclosing block (a line indented less than `indent` ends it).
    let hasSibling = false;
    for (const step of [-1, 1]) {
      for (let j = i + step; j >= 0 && j < lines.length; j += step) {
        const line = lines[j];
        if (!line.trim()) continue;
        const lead = line.length - line.trimStart().length;
        if (lead < indent) break;
        if (lead !== indent) continue;
        const sib = SIBLING.exec(line);
        if (sib && sib[1].length === indent) { hasSibling = true; break; }
      }
      if (hasSibling) break;
    }
    if (!hasSibling) continue;

    // Brace-match the en: block to find where it ends.
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      if (depth <= 0) { end = j; break; }
    }
    ranges.push([i + 1, end + 1]);
  }

  // Second shape: the halves are extended by separate statements rather than
  // nested keys - `Object.assign(labels.ar, {...})` / `Object.assign(labels.en, {...})`.
  // Requires the SAME base object to be extended for both languages.
  const ASSIGN = /^\s*Object\s*\.\s*assign\s*\(\s*([A-Za-z_$][\w$]*)\s*\.\s*(ar|arabic|en|english)\s*,\s*\{/;
  const bases = new Map();
  lines.forEach((line, i) => {
    const m = ASSIGN.exec(line);
    if (!m) return;
    const lang = /^(ar|arabic)$/.test(m[2]) ? "ar" : "en";
    if (!bases.has(m[1])) bases.set(m[1], { ar: [], en: [] });
    bases.get(m[1])[lang].push(i);
  });
  for (const { ar, en } of bases.values()) {
    if (!ar.length || !en.length) continue; // only a genuine pair counts
    for (const start of half === "ar" ? ar : en) {
      let depth = 0;
      let end = start;
      for (let j = start; j < lines.length; j += 1) {
        for (const ch of lines[j]) {
          if (ch === "{") depth += 1;
          else if (ch === "}") depth -= 1;
        }
        if (depth <= 0) { end = j; break; }
      }
      ranges.push([start + 1, end + 1]);
    }
  }
  return ranges;
};

/**
 * Line ranges of UI behind a proven development-only gate.
 *
 * Only these gates count. Production feature flags, permission and role checks
 * and ordinary conditional rendering are NOT dev gates and stay in scope.
 */
const DEV_GATE = /\bisDevBuild\b|\bimport\s*\.\s*meta\s*\.\s*env\s*\.\s*DEV\b|process\s*\.\s*env\s*\.\s*NODE_ENV\s*!==\s*["']production["']/;

export const devGatedRanges = (text) => {
  const lines = text.split("\n");
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!DEV_GATE.test(lines[i])) continue;
    // Only a gate that OPENS a JSX branch encloses anything: `{isDevBuild ? (`
    // or `{isDevBuild && (`. A bare reference guards nothing renderable.
    if (!/[?&]{1,2}\s*\($/.test(lines[i].trimEnd())) continue;
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === "(") depth += 1;
        else if (ch === ")") depth -= 1;
      }
      if (depth <= 0) { end = j; break; }
    }
    ranges.push([i + 1, end + 1]);
  }
  return ranges;
};

/**
 * Line ranges of a GENERATED PRINT DOCUMENT: a template literal written into a
 * print window, e.g. `printWindow.document.write(\`<html>...\`)`.
 *
 * That markup is print/export copy, not runtime chrome - it is never rendered
 * inside the app shell and has its own (often deliberately English) layout.
 * Bucketing it as print keeps it visible without counting it as UI debt.
 *
 * Narrow: the opener must be a document.write( that starts a template literal.
 */
export const printDocumentRanges = (text) => {
  const lines = text.split("\n");
  const ranges = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/document\s*\.\s*write\s*\(\s*`/.test(lines[i])) continue;
    // The close must be a line that IS the terminator (`);`). Matching a bare
    // backtick-paren anywhere would stop at the first NESTED template, e.g.
    // `${rows.map(([k, v]) => `<div>...</div>`).join("")}`.
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (/^\s*`\s*\)\s*;?\s*$/.test(lines[j])) { end = j; break; }
    }
    ranges.push([i + 1, end + 1]);
  }
  return ranges;
};

/**
 * Line ranges of SEED DATA factories - `const seedExpenses = () => [ ... ]`.
 *
 * The strings inside are the `title`/`category` of sample RECORDS (id, title,
 * category, amount) used as the local-storage default before real data exists.
 * They are business data a user can edit, not application chrome, so
 * translating them would rewrite records rather than labels.
 *
 * Scoped to the function, not the file: real chrome elsewhere in the same
 * module is still reported.
 */
export const seedDataRanges = (text) => {
  const lines = text.split("\n");
  const ranges = [];
  const OPEN = /^\s*(?:export\s+)?(?:const|function)\s+seed[A-Z]\w*\s*(?:=\s*\([^)]*\)\s*=>\s*)?[[{(]/;
  for (let i = 0; i < lines.length; i += 1) {
    if (!OPEN.test(lines[i])) continue;
    let depth = 0;
    let end = i;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === "[" || ch === "{") depth += 1;
        else if (ch === "]" || ch === "}") depth -= 1;
      }
      if (depth <= 0) { end = j; break; }
    }
    ranges.push([i + 1, end + 1]);
  }
  return ranges;
};

const inRanges = (line, ranges) => ranges.some(([from, to]) => line >= from && line <= to);

export function scanEnglish() {
  const buckets = {
    brokenEnglish: [],
    print: [],
    prototype: [],
    aiContent: [],
    identifiers: [],
    technical: [],
    debug: [],
    bilingual: [],
    seedData: [],
  };

  for (const file of walkSourceFiles()) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    let hits = scanFile(file).filter((hit) => hit.script === "en" && looksLikeProse(hit.value));
    if (!hits.length) continue;

    // Reclassify per HIT before the file-level bucketing below: a file can hold
    // a working bilingual table, a dev-only panel AND genuine broken chrome.
    const text = fs.readFileSync(file, "utf8");
    const bilingualRanges = [...bilingualHalfRanges(text), ...bilingualTernaryRanges(text)];
    const devRanges = devGatedRanges(text);
    const printRanges = printDocumentRanges(text);
    const seedRanges = seedDataRanges(text);
    if (bilingualRanges.length || devRanges.length || printRanges.length || seedRanges.length) {
      const take = (ranges, exclude) =>
        hits.filter((hit) => inRanges(hit.line, ranges) && !exclude.some((r) => inRanges(hit.line, r)));
      const bilingualHits = take(bilingualRanges, []);
      const devHits = take(devRanges, [bilingualRanges]);
      const printHits = take(printRanges, [bilingualRanges, devRanges]);
      const seedHits = take(seedRanges, [bilingualRanges, devRanges, printRanges]);
      if (bilingualHits.length) buckets.bilingual.push({ file: relative, total: bilingualHits.length, hits: bilingualHits });
      if (devHits.length) buckets.debug.push({ file: relative, total: devHits.length, hits: devHits });
      if (printHits.length) buckets.print.push({ file: relative, total: printHits.length, hits: printHits });
      if (seedHits.length) buckets.seedData.push({ file: relative, total: seedHits.length, hits: seedHits });
      hits = hits.filter(
        (hit) => ![bilingualRanges, devRanges, printRanges, seedRanges].some((r) => inRanges(hit.line, r))
      );
      if (!hits.length) continue;
    }

    const target =
      IDENTIFIER_FILES.has(relative) ? "identifiers"
      : PRINT_MARKERS.test(relative) ? "print"
      : PROTOTYPE_MARKERS.test(relative) ? "prototype"
      : AI_CONTENT_MARKERS.test(relative) ? "aiContent"
      : "brokenEnglish";

    const kept = hits.filter((hit) => !(hit.type === "attribute" && NON_UI_ATTRIBUTES.test(hit.attr || "")));
    const technical = hits.length - kept.length;
    if (technical) buckets.technical.push({ file: relative, total: technical });
    if (kept.length) buckets[target].push({ file: relative, total: kept.length, hits: kept });
  }

  return buckets;
}

const sum = (rows) => rows.reduce((total, row) => total + row.total, 0);

if (process.argv[1]?.endsWith("i18n-english-scan.mjs")) {
  const buckets = scanEnglish();
  console.log("bucket          files  strings");
  for (const [name, rows] of Object.entries(buckets)) {
    console.log(`${name.padEnd(15)} ${String(rows.length).padStart(4)}  ${String(sum(rows)).padStart(7)}`);
  }
  console.log(`\nENGLISH-SIDE DEFECTS (leak into Arabic mode): ${sum(buckets.brokenEnglish)} in ${buckets.brokenEnglish.length} files\n`);
  for (const row of buckets.brokenEnglish.sort((a, b) => b.total - a.total).slice(0, 30)) {
    console.log(`  ${String(row.total).padStart(4)}  ${row.file}`);
  }
  void fs;
}
