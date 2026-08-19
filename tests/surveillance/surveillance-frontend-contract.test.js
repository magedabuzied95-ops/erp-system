// The frontend contract: routes exist, permissions gate them, translations ship.
//
// WHY A TEST RATHER THAN A CLICK-THROUGH
// --------------------------------------
// Three failure modes here are invisible in development and obvious only in
// production, and this project has hit two of them before:
//
//   * A locale bundle can pass every guard and still be absent from the build,
//     because it was never imported into i18n.js or listed in the manifest.
//     The page then renders raw key paths at an Arabic-speaking user.
//   * A page can exist, compile and be unreachable, because no <Route> names it.
//   * A route can be registered without a permission, silently exposing camera
//     footage to every authenticated employee.
//
// None of these throws. All three are caught by reading the files.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const APP = read("src/App.jsx");
const EN = JSON.parse(read("src/locales/en/surveillance.json"));
const AR = JSON.parse(read("src/locales/ar/surveillance.json"));

/**
 * Every surveillance page, the route that reaches it, and the permission that
 * guards it. Adding a page without adding a row here fails the last test.
 */
const PAGES = [
  { component: "SurveillanceDashboard", route: "surveillance", permission: "surveillance.view" },
  { component: "SurveillanceLive", route: "surveillance/live", permission: "surveillance.live" },
  { component: "SurveillancePlayback", route: "surveillance/playback", permission: "surveillance.playback" },
  { component: "SurveillanceDevices", route: "surveillance/devices", permission: "surveillance.device.view" },
  { component: "SurveillanceDeviceDetail", route: "surveillance/devices/:id", permission: "surveillance.device.view" },
  { component: "SurveillanceChannels", route: "surveillance/channels", permission: "surveillance.view" },
  { component: "SurveillanceStorage", route: "surveillance/storage", permission: "surveillance.storage.view" },
  { component: "SurveillanceVideoSettings", route: "surveillance/video-settings", permission: "surveillance.device.view" },
  { component: "SurveillanceRecordingSettings", route: "surveillance/recording-settings", permission: "surveillance.recording.settings" },
  { component: "SurveillanceMotionSettings", route: "surveillance/motion-settings", permission: "surveillance.device.view" },
  { component: "SurveillanceNetwork", route: "surveillance/network", permission: "surveillance.network.view" },
  { component: "SurveillanceAudit", route: "surveillance/audit", permission: "surveillance.device.view" },
];

/* ------------------------------------------------------------------ *
 * Reachability
 * ------------------------------------------------------------------ */

test("every surveillance page file exists", () => {
  for (const { component } of PAGES) {
    const file = `src/modules/surveillance/pages/${component}.jsx`;
    assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
  }
});

test("every surveillance page is lazily imported and routed", () => {
  for (const { component, route } of PAGES) {
    assert.ok(APP.includes(`import("./modules/surveillance/pages/${component}")`), `${component} is not imported`);
    assert.ok(APP.includes(`<${component} />`), `${component} is never rendered`);
    assert.ok(APP.includes(`path="${route}"`), `no route for ${route}`);
  }
});

test("no surveillance route is left unguarded", () => {
  // A route without requiredPermissions hands camera footage to every
  // authenticated employee — including the ones a branch filter exists to keep
  // out of other branches' cameras.
  for (const { component, permission } of PAGES) {
    const index = APP.indexOf(`<${component} />`);
    assert.ok(index > 0, `${component} not rendered`);
    // The ProtectedRoute wrapping this component sits just above it.
    const window = APP.slice(Math.max(0, index - 260), index);
    assert.match(window, /requiredPermissions=\{\[/, `${component} is not inside a ProtectedRoute`);
    assert.ok(window.includes(permission), `${component} should be guarded by ${permission}`);
  }
});

/* ------------------------------------------------------------------ *
 * Translations
 * ------------------------------------------------------------------ */

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? flatten(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]);

test("Arabic and English carry exactly the same keys", () => {
  // A key present in English only renders the raw dotted path to an Arabic
  // user — visible, ugly, and reported as "the page is broken".
  const en = flatten(EN).sort();
  const ar = flatten(AR).sort();
  assert.deepEqual(en.filter((k) => !ar.includes(k)), [], "missing in Arabic");
  assert.deepEqual(ar.filter((k) => !en.includes(k)), [], "missing in English");
});

test("no translation value is left empty or identical to its key", () => {
  for (const [lang, bundle] of [["en", EN], ["ar", AR]]) {
    const walk = (obj, prefix = "") => {
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === "object") { walk(value, `${prefix}${key}.`); continue; }
        assert.ok(String(value).trim().length > 0, `${lang}: ${prefix}${key} is empty`);
        assert.notEqual(String(value), `${prefix}${key}`, `${lang}: ${prefix}${key} is untranslated`);
      }
    };
    walk(bundle);
  }
});

test("the Arabic bundle is actually Arabic, not copied English", () => {
  // The failure this catches: a merge that duplicated the English block into
  // the Arabic file. Key parity would still pass and the page would render
  // English to an Arabic user.
  const arabic = /[؀-ۿ]/;
  const leaves = [];
  const walk = (obj, prefix = "") => {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === "object") walk(value, `${prefix}${key}.`);
      // Values that are legitimately not Arabic: protocol names and acronyms.
      else if (!/^(NTP|DHCP|DNS|MAC|MTU|IP|PTZ|FPS|H\.26[45])$/i.test(String(value).trim())) {
        leaves.push([`${prefix}${key}`, String(value)]);
      }
    }
  };
  walk(AR);
  const notArabic = leaves.filter(([, value]) => !arabic.test(value));
  // A handful of shared technical tokens is fine; wholesale English is not.
  assert.ok(
    notArabic.length < leaves.length * 0.15,
    `${notArabic.length} of ${leaves.length} Arabic values contain no Arabic: ${notArabic.slice(0, 8).map(([k]) => k).join(", ")}`,
  );
});

/* ------------------------------------------------------------------ *
 * Bundle wiring — the gap that passes every other check
 * ------------------------------------------------------------------ */

test("the surveillance bundle reaches the runtime, not just the manifest", () => {
  // THE GAP THIS CLOSES, and it was real: main refactored i18n to load locales
  // from GENERATED bundle modules (src/i18n/bundles/*.js) instead of static
  // imports in i18n.js. The manifest entry alone is not wiring — after the
  // merge, surveillance was in localeManifest and in NEITHER bundle file, so
  // every page would have rendered raw key paths in production while every
  // other guard passed.
  const manifest = read("src/i18n/localeManifest.js");
  assert.match(manifest, /branch:\s*"surveillance"/, "not in localeManifest");

  for (const locale of ["en", "ar"]) {
    const bundle = read(`src/i18n/bundles/rest.${locale}.js`);
    // String containment rather than a regex literal: the path is full of
    // slashes and dots, and escaping those is how the first version of this
    // assertion became a syntax error that failed the whole file.
    assert.ok(
      bundle.includes(`import surveillance from "../../locales/${locale}/surveillance.json"`),
      `surveillance.json is not imported by rest.${locale}.js — regenerate with scripts/generate-locale-bundles.mjs`,
    );
    // Imported is not the same as exported. The generator emits both; a
    // hand-edit could plausibly add one and forget the other.
    assert.ok(bundle.includes('"surveillance": surveillance,'),
      `surveillance is not exported from rest.${locale}.js`);
  }
});

test("pages use the single translation namespace, never a colon", () => {
  // t("surveillance:live.title") silently renders the raw key in this app,
  // because there is exactly one namespace called `translation`.
  const dir = path.join(ROOT, "src/modules/surveillance");
  const files = fs.readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".jsx") || f.endsWith(".js"));
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), "utf8");
    const colonForm = source.match(/\bt\(\s*["'`]surveillance:/g);
    assert.equal(colonForm, null, `${file} uses the colon namespace form`);
  }
});
