/**
 * Shared navigation / RBAC localization guard.
 *
 * Sidebar sections and items are declared in rbacStore.js with ENGLISH label
 * strings, and src/i18n/navigation.js maps those strings to translation keys. A
 * label with no mapping silently falls through untranslated — that is exactly how
 * "Inventory Count" shipped to production inside the Arabic sidebar.
 *
 * This guard fails when a nav label has no mapping, or maps to a key that does
 * not resolve in every locale.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const rbac = read("src/modules/permissions/lib/rbacStore.js");
const nav = read("src/i18n/navigation.js");

/** Parses a `const NAME = { "label": "key", ... }` block into a Map. */
const parseKeyMap = (source, constName) => {
  const start = source.indexOf(`const ${constName} = {`);
  assert.notEqual(start, -1, `${constName} is missing from src/i18n/navigation.js`);
  const end = source.indexOf("\n};", start);
  const body = source.slice(start, end);
  const map = new Map();
  for (const match of body.matchAll(/^\s*(?:"([^"]+)"|([A-Za-z][\w]*))\s*:\s*"([^"]+)"/gm)) {
    map.set(match[1] ?? match[2], match[3]);
  }
  return map;
};

const SECTION_KEYS = parseKeyMap(nav, "SECTION_TITLE_KEYS");
const ITEM_KEYS = parseKeyMap(nav, "ITEM_LABEL_KEYS");

const sectionTitles = [...new Set([...rbac.matchAll(/\btitle:\s*"([^"]+)"/g)].map((m) => m[1]))];
const itemLabels = [...new Set([...rbac.matchAll(/\blabel:\s*"([^"]+)"/g)].map((m) => m[1]))];

const scanner = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-keys.mjs")).href);
const dictionaries = await scanner.loadDictionaryKeys();

test("rbacStore declares at least the known navigation surface", () => {
  // Guards against the regex silently matching nothing after a refactor.
  assert.ok(sectionTitles.length >= 10, `only ${sectionTitles.length} section titles parsed`);
  assert.ok(itemLabels.length >= 50, `only ${itemLabels.length} item labels parsed`);
});

test("every RBAC navigation label maps to a translation key", () => {
  const unmapped = [
    ...sectionTitles.filter((title) => !SECTION_KEYS.has(title)).map((title) => `section "${title}"`),
    ...itemLabels.filter((label) => !ITEM_KEYS.has(label)).map((label) => `item "${label}"`),
  ];
  assert.deepEqual(
    unmapped,
    [],
    `These navigation labels render untranslated. Add them to SECTION_TITLE_KEYS / ITEM_LABEL_KEYS in src/i18n/navigation.js:\n- ${unmapped.join(
      "\n- "
    )}`
  );
});

test("every mapped navigation key resolves in every locale", () => {
  const broken = [];
  for (const [label, key] of [...SECTION_KEYS, ...ITEM_KEYS]) {
    for (const locale of Object.keys(dictionaries)) {
      if (!scanner.resolves(key, dictionaries[locale])) broken.push(`${locale}: ${key} (label "${label}")`);
    }
  }
  assert.deepEqual(broken, [], `Navigation keys with no dictionary entry:\n- ${broken.join("\n- ")}`);
});

test("navigation keys are presentation only — routes and permissions stay raw", () => {
  // A translated value must never leak into a route or a permission check.
  for (const key of [...SECTION_KEYS.values(), ...ITEM_KEYS.values()]) {
    assert.match(key, /^sidebar\./, `${key} should live under the sidebar namespace`);
  }
  assert.doesNotMatch(rbac, /\bto:\s*t\(|\bpermission:\s*t\(/, "routes and permissions must not be translated");
});
