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
  "whatsapp", "facebook", "messenger", "instagram", "meta", "google", "tiktok", "bosta", "cloudinary", "vercel",
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

export function scanEnglish() {
  const buckets = {
    brokenEnglish: [],
    print: [],
    prototype: [],
    aiContent: [],
    identifiers: [],
    technical: [],
    debug: [],
  };

  for (const file of walkSourceFiles()) {
    const relative = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    const hits = scanFile(file).filter((hit) => hit.script === "en" && looksLikeProse(hit.value));
    if (!hits.length) continue;

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
