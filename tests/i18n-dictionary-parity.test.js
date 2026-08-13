/**
 * Dictionary parity + language-purity guards.
 *
 * These protect the two failure modes that make the ERP feel half-translated:
 *   1. A key exists in one locale and not the other, so one language silently
 *      falls back to a humanised key or to English.
 *   2. A key exists in both locales but carries the WRONG language's text, so an
 *      Arabic screen renders English chrome (or vice versa).
 *
 * The guards read the resource tree through src/i18n/localeManifest.js, i.e.
 * exactly what i18next serves at runtime.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const localesDir = path.join(repoRoot, "src", "locales");

const manifest = await import(pathToFileURL(path.join(repoRoot, "src", "i18n", "localeManifest.js")).href);
const { SUPPORTED_LOCALES, RESOURCE_BRANCHES, PARITY_EXCEPTIONS, LOCALE_PURITY_EXCEPTIONS, resolveBranch } = manifest;

const ARABIC_RE = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const LATIN_RE = /[A-Za-z]/;

/**
 * Latin tokens that are correct inside Arabic UI: identifiers, units, file
 * formats, currencies, and brand/provider names. Keep in sync with
 * docs/LOCALIZATION_GUIDE.md.
 */
const PRESERVED_LATIN = new Set([
  "sku", "pos", "erp", "qr", "id", "url", "api", "csv", "pdf", "xlsx", "png", "jpg", "svg", "html", "json",
  "pdf a4", "a4", "a5", "csv/pdf", "egp", "usd", "sar", "aed", "eur", "gbp", "vat", "iban", "otp", "sms",
  "whatsapp", "facebook", "messenger", "instagram", "meta", "google", "tiktok", "bosta", "cloudinary",
  "shopify", "paymob", "fawry", "visa", "mastercard", "gmail", "youtube", "english", "kpi", "roi", "aov",
  "ltv", "cogs", "p&l", "crm", "ai", "gtin", "ean", "upc", "barcode shop", "n/a", "x", "ok",
]);

/** Interpolation-only values such as "{{count}}" or "{{start}} - {{end}}". */
const isInterpolationOnly = (value) => !value.replace(/\{\{[^}]*\}\}/g, "").replace(/[\s\d.,:/|+()%-]/g, "");

const readBundle = (locale, file) => {
  const filePath = path.join(localesDir, locale, `${file}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
};

const loadLocaleFiles = (locale) => {
  const files = {};
  for (const entry of fs.readdirSync(path.join(localesDir, locale))) {
    if (!entry.endsWith(".json")) continue;
    files[entry.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(localesDir, locale, entry), "utf8"));
  }
  return files;
};

const flatten = (value, prefix, out) => {
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
};

const buildFlatTree = (locale) => {
  const files = loadLocaleFiles(locale);
  const out = new Map();
  for (const entry of RESOURCE_BRANCHES) {
    flatten(resolveBranch(entry, files), entry.branch, out);
  }
  return out;
};

const exemptKeys = new Set(PARITY_EXCEPTIONS.map((item) => item.key));
const purityExactKeys = new Set(LOCALE_PURITY_EXCEPTIONS.filter((item) => !item.prefix).map((item) => item.key));
const purityPrefixes = LOCALE_PURITY_EXCEPTIONS.filter((item) => item.prefix).map((item) => item.key);
const isPurityExempt = (key) => purityExactKeys.has(key) || purityPrefixes.some((prefix) => key.startsWith(prefix));
const trees = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, buildFlatTree(locale)]));

test("every locale bundle referenced by the manifest exists for every locale", () => {
  const missing = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const entry of RESOURCE_BRANCHES) {
      for (const file of Array.isArray(entry.file) ? entry.file : [entry.file]) {
        if (!readBundle(locale, file)) missing.push(`${locale}/${file}.json (branch "${entry.branch}")`);
      }
    }
  }
  assert.deepEqual(missing, [], `Missing locale bundles:\n- ${missing.join("\n- ")}`);
});

test("no manifest branch is declared twice", () => {
  const seen = new Set();
  const duplicates = [];
  for (const entry of RESOURCE_BRANCHES) {
    if (seen.has(entry.branch)) duplicates.push(entry.branch);
    seen.add(entry.branch);
  }
  assert.deepEqual(duplicates, [], `Duplicate resource branches silently drop a whole bundle: ${duplicates.join(", ")}`);
});

test("Arabic and English dictionaries expose the same keys", () => {
  const [first, ...rest] = SUPPORTED_LOCALES;
  const problems = [];
  for (const other of rest) {
    for (const key of trees[first].keys()) {
      if (!trees[other].has(key) && !exemptKeys.has(key)) problems.push(`missing in ${other}: ${key}`);
    }
    for (const key of trees[other].keys()) {
      if (!trees[first].has(key) && !exemptKeys.has(key)) problems.push(`missing in ${first}: ${key}`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `Dictionary parity broken (${problems.length}). Add the key to BOTH locales:\n- ${problems.slice(0, 60).join("\n- ")}`
  );
});

test("no translation value is an empty string", () => {
  const empties = [];
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, value] of trees[locale]) {
      if (typeof value === "string" && !value.trim()) empties.push(`${locale}: ${key}`);
    }
  }
  assert.deepEqual(empties, [], `Empty translations render as blank UI:\n- ${empties.slice(0, 40).join("\n- ")}`);
});

test("Arabic dictionaries do not serve English application chrome", () => {
  const leaks = [];
  for (const [key, value] of trees.ar) {
    if (typeof value !== "string") continue;
    const clean = value.trim();
    if (!clean || ARABIC_RE.test(clean)) continue;
    if (!LATIN_RE.test(clean)) continue;
    if (isPurityExempt(key)) continue;
    if (PRESERVED_LATIN.has(clean.toLowerCase())) continue;
    if (isInterpolationOnly(clean)) continue;
    leaks.push(`${key} = ${clean}`);
  }
  assert.deepEqual(
    leaks,
    [],
    `Arabic dictionary contains ${leaks.length} untranslated English value(s). Translate them, or add the token to PRESERVED_LATIN if it is a brand/identifier:\n- ${leaks
      .slice(0, 60)
      .join("\n- ")}`
  );
});

test("English dictionaries do not serve Arabic application chrome", () => {
  const leaks = [];
  for (const [key, value] of trees.en) {
    if (typeof value !== "string") continue;
    if (!ARABIC_RE.test(value)) continue;
    if (isPurityExempt(key)) continue;
    leaks.push(`${key} = ${value.trim()}`);
  }
  assert.deepEqual(
    leaks,
    [],
    `English dictionary contains ${leaks.length} Arabic value(s):\n- ${leaks.slice(0, 60).join("\n- ")}`
  );
});
