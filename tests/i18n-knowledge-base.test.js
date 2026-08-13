/**
 * Focused guard for the AI Support Knowledge Base localization unit.
 *
 * This page was deliberately held back from the localization release because
 * `main` had grown two new fields (`store_address`, `maps_url`) plus URL
 * validation on the same surface. Reconciling it by hand is exactly the change
 * that can silently translate a PERSISTED field id or drop a new field, so the
 * unit carries its own guard rather than relying on the global counters:
 *
 *   1. the persisted field ids are the API contract - never translated, never lost
 *   2. every chrome string the page renders resolves in BOTH locales
 *   3. the labels are carried as literal KEYS, not resolved at module scope
 *   4. the URL validation added by `main` survives the migration
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const pagePath = path.join(repoRoot, "src", "modules", "aiSupport", "pages", "AiSupportKnowledgeBase.jsx");
const source = fs.readFileSync(pagePath, "utf8");

const manifest = await import(pathToFileURL(path.join(repoRoot, "src", "i18n", "localeManifest.js")).href);
const { SUPPORTED_LOCALES, RESOURCE_BRANCHES, resolveBranch } = manifest;

const localesDir = path.join(repoRoot, "src", "locales");
const loadLocaleFiles = (locale) => {
  const files = {};
  for (const entry of fs.readdirSync(path.join(localesDir, locale))) {
    if (!entry.endsWith(".json")) continue;
    files[entry.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(localesDir, locale, entry), "utf8"));
  }
  return files;
};

const filesByLocale = Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, loadLocaleFiles(locale)]));

/** Resolves a dotted `t()` key against the composed runtime tree for one locale. */
const resolveKey = (key, locale) => {
  const [branch, ...rest] = key.split(".");
  const entry = RESOURCE_BRANCHES.find((item) => item.branch === branch);
  if (!entry) return undefined;
  let node = resolveBranch(entry, filesByLocale[locale]);
  for (const segment of rest) {
    if (!node || typeof node !== "object") return undefined;
    node = node[segment];
  }
  return typeof node === "string" ? node : undefined;
};

/** The `fields` array entries, read straight out of the page source. */
const fieldEntries = [...source.matchAll(/\{\s*key:\s*"([a-z_]+)",\s*labelKey:\s*`\$\{KB\}\.([a-z_.]+)`([^}]*)\}/g)].map(
  ([, key, labelPath, tail]) => ({
    key,
    labelKey: `aiSupport.knowledgeBase.fields.${labelPath}`,
    placeholderKey: /placeholderKey:\s*`\$\{KB\}\.([a-z_.]+)`/.exec(tail)?.[1]
      ? `aiSupport.knowledgeBase.fields.${/placeholderKey:\s*`\$\{KB\}\.([a-z_.]+)`/.exec(tail)[1]}`
      : null,
  })
);

/**
 * The persisted contract. These ids are written into
 * `website_settings.settings.knowledge_base` and read back by the AI grounding
 * gate, so they are business data, not chrome.
 */
const PERSISTED_FIELD_IDS = [
  "store_name",
  "phone",
  "whatsapp",
  "maps_url",
  "store_address",
  "branch_working_hours",
  "payment_methods",
  "shipping_policy",
  "return_exchange_policy",
  "delivery_notes",
  "warranty_notes",
  "human_support_message",
  "brand_tone_instructions",
];

test("the page still renders every persisted knowledge-base field", () => {
  assert.deepEqual(
    fieldEntries.map((field) => field.key).sort(),
    [...PERSISTED_FIELD_IDS].sort(),
    "A persisted field id was renamed, dropped or added. These are the API contract, not chrome."
  );
});

test("defaultForm carries exactly the persisted field ids", () => {
  const block = /const defaultForm = \{([\s\S]*?)\};/.exec(source)?.[1] ?? "";
  const keys = [...block.matchAll(/^\s*([a-z_]+):/gm)].map(([, key]) => key);
  assert.deepEqual(keys.sort(), [...PERSISTED_FIELD_IDS].sort());
});

test("every knowledge-base chrome key resolves in both locales", () => {
  const keysFromFields = fieldEntries.flatMap((field) => [field.labelKey, field.placeholderKey].filter(Boolean));
  // `const KB = "aiSupport.knowledgeBase.fields"` is a key PREFIX, not a leaf.
  const KB_PREFIX = /const KB = "([^"]+)"/.exec(source)?.[1];
  const keysFromJsx = [...source.matchAll(/"(aiSupport\.knowledgeBase\.[A-Za-z0-9_.]+)"/g)]
    .map(([, key]) => key)
    .filter((key) => key !== KB_PREFIX);
  const unresolved = [];
  for (const key of new Set([...keysFromFields, ...keysFromJsx])) {
    for (const locale of SUPPORTED_LOCALES) {
      if (!resolveKey(key, locale)) unresolved.push(`${key} (missing in ${locale})`);
    }
  }
  assert.deepEqual(unresolved, [], `Knowledge Base keys with no dictionary entry:\n- ${unresolved.join("\n- ")}`);
});

test("field labels are carried as keys, never resolved at module scope", () => {
  const fieldsBlock = /const fields = \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? "";
  assert.ok(fieldsBlock, "could not locate the fields array");
  assert.ok(
    !/\bt\(/.test(fieldsBlock),
    "The module-scope fields array resolves translations eagerly; a language switch would not relabel it."
  );
});

test("the new store_address and maps_url fields keep their business behaviour", () => {
  // main added these two fields plus URL validation; localization must not weaken them.
  assert.match(source, /const validateUrl = /, "URL validation was removed");
  assert.match(source, /\["http:", "https:"\]\.includes\(new URL\(text\)\.protocol\)/, "URL protocol check changed");
  assert.match(source, /mapsUrlValid = validateUrl\(form\.maps_url\)/, "maps_url is no longer validated");
  assert.match(source, /!phoneValid \|\| !whatsappValid \|\| !mapsUrlValid/, "save no longer blocks on validation");
  assert.match(source, /knowledge_base: form/, "the save payload shape changed");
});

test("no Arabic chrome literal is left in the page", () => {
  const leaks = source
    .split(/\r?\n/)
    .map((line, index) => [index + 1, line])
    .filter(([, line]) => /[؀-ۿ]/.test(line));
  assert.deepEqual(leaks, [], `Arabic literals remain:\n${leaks.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`);
});

test("the page direction follows the active language", () => {
  assert.ok(!/dir="rtl"/.test(source), "the page pins itself to RTL, so English mode renders right-to-left");
  assert.match(source, /dir=\{i18n\.dir\(\)\}/);
});
