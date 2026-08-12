/**
 * Shared scanner for the localization guards.
 *
 * It finds user-visible hardcoded UI strings in the ERP frontend and classifies
 * them by script (Arabic vs Latin) so that BOTH directions of localization debt
 * are measurable:
 *
 *   - English chrome hardcoded into a surface that must render Arabic
 *   - Arabic chrome hardcoded into a surface that must render English
 *
 * The scanner is deliberately conservative. Business data, API/system strings,
 * technical identifiers, brand names and logs are not localization debt and are
 * filtered out. False negatives are preferred over false positives, because the
 * output feeds a CI guard.
 */
import fs from "node:fs";
import path from "node:path";

export const REPO_ROOT = process.cwd();
export const SCAN_ROOT = path.resolve(REPO_ROOT, "src");

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git", "__snapshots__"]);

/**
 * Storefront is a customer-facing surface with its own localization contract and
 * is explicitly out of scope for the ERP/Manager/Employee convergence phase.
 * Locale bundles and the i18n runtime obviously contain literal strings by design.
 */
const SKIP_PATH_MARKERS = [
  `${path.sep}storefront${path.sep}`,
  `${path.sep}locales${path.sep}`,
  `${path.sep}i18n${path.sep}`,
  `${path.sep}assets${path.sep}`,
];

/** Surfaces, used for reporting/prioritisation only. */
const SURFACE_RULES = [
  ["employee-portal", [`${path.sep}modules${path.sep}employees${path.sep}`, `${path.sep}employeePortal${path.sep}`, `${path.sep}modules${path.sep}attendance${path.sep}`]],
  ["manager-portal", [`${path.sep}modules${path.sep}managerPortal${path.sep}`]],
  ["pos", [`${path.sep}modules${path.sep}pos${path.sep}`]],
  ["shared", [`${path.sep}shared${path.sep}`, `${path.sep}components${path.sep}`, `${path.sep}layouts${path.sep}`]],
];

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ASCII_LETTER_RE = /[A-Za-z]/;

/**
 * Latin tokens that legitimately appear inside Arabic UI and are never
 * translated: identifiers, units, provider/brand names, currency and file
 * formats. See docs/LOCALIZATION_GUIDE.md ("What NOT to translate").
 */
const PRESERVED_TOKENS = new Set([
  "a4", "a5", "sku", "pos", "erp", "qr", "id", "url", "api", "csv", "pdf", "xlsx", "png", "jpg", "svg",
  "egp", "usd", "sar", "aed", "eur", "gbp", "vat", "iban", "otp", "sms", "pin", "cvv",
  "whatsapp", "facebook", "messenger", "instagram", "meta", "google", "tiktok", "bosta", "cloudinary",
  "vercel", "paymob", "fawry", "visa", "mastercard", "shopify", "gmail", "youtube", "twitter", "x",
  "p&l", "cogs", "kpi", "roi", "aov", "ltv", "eta", "gtin", "ean", "upc", "imei", "html", "json", "xml",
  "ok", "no", "id:", "n/a", "usdt", "btc", "ai", "gpt", "llm", "crm", "hr", "it", "ui", "ux", "cta",
]);

const CLASSNAME_RE =
  /^(flex|grid|block|inline|hidden|absolute|relative|sticky|fixed|mt-|mb-|ml-|mr-|ms-|me-|px-|py-|pt-|pb-|pl-|pr-|ps-|pe-|gap-|w-|h-|min-|max-|text-|bg-|border|rounded|shadow|hover:|focus:|active:|disabled:|group|space-|items-|justify-|self-|col-|row-|z-|opacity-|transition|duration-|animate-|overflow|truncate|cursor-|select-|whitespace|font-|leading-|tracking-|divide-)/;
const URL_RE = /^(https?:|\/\/|\/[a-z0-9]|#|data:|mailto:|tel:|blob:|\.\/|\.\.\/)/i;
const CODE_FRAGMENT_RE =
  /&&|\|\||=>|===|!==|!=|\?\?|\?\.|\$\{|<\/|\/>|[\w$]+\([^)]*\)|\b(?:if|else|for|while|switch|case|return|const|let|var|new|typeof|await|async|function|import|export|null|undefined|true|false)\b/;
const TEMPLATE_ONLY_RE = /^\{[^}]*\}$/;
const IDENTIFIER_RE = /^[a-z][a-zA-Z0-9]*$/; // camelCase / lowercase single token → almost always technical
const CONST_RE = /^[A-Z0-9_]+$/;
const NUMERIC_RE = /^[\d\s.,:/+()%-]+$/;

/** JSX attributes whose string value is rendered to the user. */
const LOCALIZABLE_ATTRIBUTES = [
  "placeholder",
  "title",
  "aria-label",
  "aria-description",
  "alt",
  "label",
  "emptyText",
  "emptyLabel",
  "empty",
  "fallback",
  "heading",
  "subtitle",
  "description",
  "helperText",
  "hint",
  "tooltip",
  "confirmLabel",
  "cancelLabel",
  "submitLabel",
  "actionLabel",
  "checkoutLabel",
];

/** Object-literal / variable keys whose string value is rendered to the user. */
const LOCALIZABLE_KEYS = [
  "label",
  "title",
  "heading",
  "subtitle",
  "subheading",
  "description",
  "placeholder",
  "emptyText",
  "emptyLabel",
  "helperText",
  "hint",
  "tooltip",
  "message",
  "successMessage",
  "errorMessage",
  "confirmText",
  "cancelText",
  "submitText",
  "caption",
  "badge",
  "cta",
];

const TRANSLATION_CALL_RE =
  /(?:^|[^\w$])(?:t|tt|i18n\.t|translate|posLabel|sfText|receiptPrintLabel|invoicePrintLabel|localize|label)\(\s*$/;

const hasArabic = (value) => ARABIC_RE.test(value);
const hasAsciiLetters = (value) => ASCII_LETTER_RE.test(value);

function normalise(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * Returns true when the string is technical/data rather than application chrome.
 */
function isNoise(value) {
  const clean = normalise(value);
  if (!clean) return true;
  if (clean.length < 2 || clean.length > 200) return true;
  // Real UI text starts with a word character, not punctuation or an operator.
  if (!/^[\p{L}\p{N}]/u.test(clean)) return true;
  if (NUMERIC_RE.test(clean)) return true;
  if (PRESERVED_TOKENS.has(clean.toLowerCase())) return true;
  if (CLASSNAME_RE.test(clean)) return true;
  if (URL_RE.test(clean)) return true;
  if (CODE_FRAGMENT_RE.test(clean)) return true;
  if (TEMPLATE_ONLY_RE.test(clean)) return true;
  if (!hasArabic(clean)) {
    // Latin-only candidates need stricter filtering: most short lowercase or
    // SCREAMING tokens are enum values, query keys or CSS, not UI text.
    if (!hasAsciiLetters(clean)) return true;
    if (IDENTIFIER_RE.test(clean)) return true;
    if (CONST_RE.test(clean)) return true;
    if (clean.length < 3) return true;
    // A single Latin word that is all-lowercase is almost always an enum/slug.
    if (!clean.includes(" ") && clean === clean.toLowerCase() && !/[A-Z]/.test(clean)) return true;
  }
  return false;
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function isInsideComment(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const linePrefix = text.slice(lineStart, index);
  if (/(^|\s)\/\//.test(linePrefix)) return true;
  const lastBlockOpen = text.lastIndexOf("/*", index);
  if (lastBlockOpen === -1) return false;
  const lastBlockClose = text.lastIndexOf("*/", index);
  return lastBlockOpen > lastBlockClose;
}

function isTranslationCallAt(text, index) {
  return TRANSLATION_CALL_RE.test(text.slice(Math.max(0, index - 48), index));
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ATTRIBUTE_RE = new RegExp(
  `\\b(${LOCALIZABLE_ATTRIBUTES.map(escapeForRegex).join("|")})\\s*=\\s*(?:"([^"\\n]*)"|'([^'\\n]*)')`,
  "g"
);
const KEY_RE = new RegExp(
  `\\b(${LOCALIZABLE_KEYS.map(escapeForRegex).join("|")})\\s*:\\s*(?:"([^"\\n]*)"|'([^'\\n]*)'|\`([^\`\\n$]*)\`)`,
  "g"
);
const NOTIFY_RE =
  /\b(?:toast|notify)\s*(?:\.\s*(?:success|error|info|warning|loading|message|warn))?\s*\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`)/g;
const DIALOG_RE =
  /\b(?:window\s*\.\s*)?(?:confirm|alert|prompt)\s*\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`)/g;
/**
 * JSX text nodes.
 *
 * The text run may END at `{` as well as at `<`, so that the extremely common
 * "label followed by an interpolation" shape is counted:
 *
 *   <div>\u0627\u0644\u0625\u064A\u0631\u0627\u062F: {formatCurrency(x)}</div>
 *
 * The previous form required the whole run to be brace-free, so every such node
 * was skipped and the file reported zero debt while leaking real chrome.
 *
 * The opening `>` must genuinely close a JSX tag: it has to follow an
 * identifier, quote, `}`, `]` or `/`, and must not be part of `=>` or `>=`.
 * Without that anchor a plain comparison like `if (a > b) {` matches and the
 * metric fills with false positives.
 */
const JSX_TEXT_RE = /(?<=[A-Za-z0-9_"'}\])\/])>(?!=)([^<>{}\n]*[A-Za-z\u0600-\u06FF][^<>{}\n]*)[<{]/g;
const TERNARY_LOCALE_RE =
  /\b(?:isArabic|isAr|isRtl|isRTL|lang|language|locale|currentLanguage)\b[^\n;]{0,40}\?\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n$]*`)\s*:\s*(?:"[^"\n]*"|'[^'\n]*'|`[^`\n$]*`)/g;

/**
 * A well-formed BCP-47 language tag: "ar", "en-US", "ar-EG". These are locale
 * IDENTIFIERS handed to formatting APIs, never user-visible text, so a ternary
 * that only picks between them is configuration rather than a translation leak.
 */
const BCP47_TAG_RE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/;

/**
 * Locale-consuming APIs. The exclusion additionally requires one of these next
 * to the ternary, so a construct that merely happens to yield two short Latin
 * words - `? "ar" : "en"` feeding a dictionary lookup, say - is still reported.
 */
const LOCALE_API_RE =
  /\b(?:Intl\s*\.\s*(?:DateTimeFormat|NumberFormat|Collator|RelativeTimeFormat|ListFormat|PluralRules|Segmenter)|toLocaleString|toLocaleDateString|toLocaleTimeString|toLocaleLowerCase|toLocaleUpperCase)\b/;

const PATTERNS = [
  { type: "jsx-text", regex: JSX_TEXT_RE, checkTranslationCall: false },
  { type: "attribute", regex: ATTRIBUTE_RE, valueFrom: 2 },
  { type: "object-key", regex: KEY_RE, valueFrom: 2 },
  { type: "notification", regex: NOTIFY_RE, valueFrom: 1 },
  { type: "dialog", regex: DIALOG_RE, valueFrom: 1 },
];

export function surfaceFor(relativeFile) {
  const normalized = path.sep === "/" ? relativeFile : relativeFile.split("/").join(path.sep);
  for (const [surface, markers] of SURFACE_RULES) {
    if (markers.some((marker) => normalized.includes(marker))) return surface;
  }
  return "main-erp";
}

export function walkSourceFiles(dir = SCAN_ROOT, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, output);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      if (SKIP_PATH_MARKERS.some((marker) => `${full}${path.sep}`.includes(marker))) continue;
      output.push(full);
    }
  }
  return output;
}

export function scanFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const seen = new Set();
  const hits = [];

  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    for (const match of text.matchAll(pattern.regex)) {
      const index = match.index || 0;
      const from = pattern.valueFrom ?? 1;
      let raw = "";
      for (let i = from; i < match.length; i += 1) {
        if (typeof match[i] === "string") {
          raw = match[i];
          break;
        }
      }
      const value = normalise(raw);
      if (isNoise(value)) continue;
      if (isInsideComment(text, index)) continue;
      if (pattern.checkTranslationCall !== false && isTranslationCallAt(text, index)) continue;

      const line = lineNumberAt(text, index);
      const id = `${line}:${pattern.type}:${value}`;
      if (seen.has(id)) continue;
      seen.add(id);

      hits.push({
        type: pattern.type,
        line,
        value,
        script: hasArabic(value) ? "ar" : "en",
      });
    }
  }

  // Inline language ternaries are a parallel localization system and are debt on
  // their own, regardless of which branch is Arabic.
  TERNARY_LOCALE_RE.lastIndex = 0;
  for (const match of text.matchAll(TERNARY_LOCALE_RE)) {
    const index = match.index || 0;
    if (isInsideComment(text, index)) continue;
    // A direction-driven ternary over CSS classes is styling, not localization.
    const branches = [...match[0].matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n$]*)`/g)].map((m) =>
      normalise(m[1] ?? m[2] ?? m[3] ?? "")
    );
    if (branches.length && branches.every((branch) => isNoise(branch))) continue;
    // A ternary that only chooses between BCP-47 tags next to a locale-consuming
    // API is configuration, not chrome: `Intl.DateTimeFormat(isAr ? "ar-EG" : "en-US")`
    // must stay literal, and reporting it as debt makes the metric untruthful.
    // A tag carrying a region/extension subtag ("en-US", "ar-EG-u-nu-latn") is
    // unambiguously a locale id, so it stands on its own. A bare "ar"/"en" is
    // also an ordinary word, so it additionally needs a locale API in view.
    const allTags = branches.length && branches.every((branch) => BCP47_TAG_RE.test(branch));
    // `some`, not `every`: the matched span often also picks up a default param
    // or the comparison operand (`(language = "en") => language === "ar" ? ...`),
    // which are bare tags. One qualified tag among all-valid tags is decisive.
    const allQualified = allTags && branches.some((branch) => branch.includes("-"));
    if (
      allTags &&
      (allQualified ||
        LOCALE_API_RE.test(text.slice(Math.max(0, index - 200), index + match[0].length + 60)))
    ) {
      continue;
    }
    const line = lineNumberAt(text, index);
    const value = normalise(match[0]).slice(0, 120);
    const id = `${line}:inline-ternary:${value}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hits.push({ type: "inline-ternary", line, value, script: hasArabic(value) ? "ar" : "en" });
  }

  hits.sort((a, b) => a.line - b.line || a.value.localeCompare(b.value));
  return hits;
}

export function scanRepository() {
  const files = walkSourceFiles();
  const results = [];
  for (const file of files) {
    const hits = scanFile(file);
    if (!hits.length) continue;
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    results.push({
      file: relative,
      surface: surfaceFor(relative),
      hits,
      arabic: hits.filter((hit) => hit.script === "ar").length,
      english: hits.filter((hit) => hit.script === "en").length,
      total: hits.length,
    });
  }
  results.sort((a, b) => b.total - a.total || a.file.localeCompare(b.file));
  return { scannedFiles: files.length, results };
}

export function summarise(results) {
  const summary = {
    files: results.length,
    arabic: 0,
    english: 0,
    total: 0,
    mixedFiles: 0,
    bySurface: {},
  };
  for (const entry of results) {
    summary.arabic += entry.arabic;
    summary.english += entry.english;
    summary.total += entry.total;
    if (entry.arabic > 0 && entry.english > 0) summary.mixedFiles += 1;
    const bucket = (summary.bySurface[entry.surface] ||= { files: 0, arabic: 0, english: 0, total: 0, mixedFiles: 0 });
    bucket.files += 1;
    bucket.arabic += entry.arabic;
    bucket.english += entry.english;
    bucket.total += entry.total;
    if (entry.arabic > 0 && entry.english > 0) bucket.mixedFiles += 1;
  }
  return summary;
}
