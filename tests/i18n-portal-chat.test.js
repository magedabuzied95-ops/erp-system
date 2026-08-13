/**
 * Focused guard for the shared portal-chat localization unit.
 *
 * This surface is rendered by BOTH the Employee chat inbox and the Manager
 * portal, and it carried the one raw/display entanglement in the whole sweep:
 * the contact panel focused the message-search box with
 * `document.querySelector('input[placeholder="بحث"]')`, i.e. it looked the
 * element up by its RENDERED label. Translating the placeholder would have
 * silently broken the focus jump in English with no error anywhere.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const sharedChat = read("src/shared/chat/SharedPortalChat.jsx");
const contactInfo = read("src/shared/chat/PortalChatContactInfo.jsx");
const employeeInbox = read("src/modules/employees/pages/UnifiedEmployeeChatInbox.jsx");

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

const ARABIC = /[؀-ۿ]/;

test("the message search box is found by ref, never by its rendered placeholder", () => {
  assert.ok(
    !/document\.querySelector\(['"]input\[placeholder/.test(sharedChat),
    "a DOM lookup still keys on a rendered placeholder; translating it would break the focus jump"
  );
  assert.match(sharedChat, /const messageSearchRef = useRef\(null\)/);
  assert.match(sharedChat, /ref=\{messageSearchRef\}/);
  assert.match(sharedChat, /messageSearchRef\.current\?\.focus\?\.\(\)/);
});

test("chat timestamps follow the active language instead of pinning ar-EG", () => {
  assert.ok(
    !/new Intl\.DateTimeFormat\("ar-EG/.test(sharedChat),
    "a formatter is still pinned to ar-EG, so English mode renders Arabic month names"
  );
  assert.match(sharedChat, /const chatDateLocale = \(\) =>/);
  // Resolved per call, not captured once at module scope.
  assert.match(sharedChat, /chatDateLocale\(\)/);
});

test("header and notice props fall back to translations, not to Arabic literals", () => {
  for (const prop of ["headerTitle", "headerKicker", "secureNotice"]) {
    assert.ok(
      !new RegExp(`${prop} = "`).test(sharedChat),
      `${prop} still has a hardcoded literal default`
    );
    assert.match(sharedChat, new RegExp(`resolved${prop[0].toUpperCase()}${prop.slice(1)} = ${prop} \\?\\?`));
  }
});

test("both portal-chat consumers pass translated copy", () => {
  assert.ok(!ARABIC.test(employeeInbox), "the Employee chat inbox still holds Arabic literals");
  assert.match(employeeInbox, /t\("employeePortal\.chat\.admin\.headerKickerManagement"\)/);
});

test("no Arabic chrome literal is left in the shared chat surface", () => {
  for (const [name, source] of [["SharedPortalChat", sharedChat], ["PortalChatContactInfo", contactInfo]]) {
    const leaks = source
      .split(/\r?\n/)
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => ARABIC.test(line) && !line.trim().startsWith("//") && !line.trim().startsWith("*"));
    assert.deepEqual(leaks, [], `${name} still has Arabic literals:\n${leaks.map(([n, l]) => `  ${n}: ${l.trim()}`).join("\n")}`);
  }
});

test("every portal-chat key the surface addresses resolves in both locales", () => {
  const keys = new Set(
    [sharedChat, contactInfo, employeeInbox].flatMap((source) =>
      [...source.matchAll(/t\("((?:employeePortal|common)\.[A-Za-z0-9_.]+)"/g)].map(([, key]) => key)
    )
  );
  assert.ok(keys.size > 25, `expected the surface to address many keys, found ${keys.size}`);
  const unresolved = [];
  for (const key of keys) {
    for (const locale of SUPPORTED_LOCALES) {
      if (!resolveKey(key, locale)) unresolved.push(`${key} (missing in ${locale})`);
    }
  }
  assert.deepEqual(unresolved, [], `Portal-chat keys with no dictionary entry:\n- ${unresolved.join("\n- ")}`);
});

test("the chat panels follow the active direction", () => {
  assert.ok(!/dir="rtl"/.test(sharedChat), "SharedPortalChat pins itself to RTL");
  assert.ok(!/dir="rtl"/.test(contactInfo), "PortalChatContactInfo pins itself to RTL");
});
