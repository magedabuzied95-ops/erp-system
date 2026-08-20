// The sidebar must offer a way INTO every page that exists.
//
// THE PRODUCTION BUG THIS EXISTS FOR
// ----------------------------------
// Twelve Surveillance pages shipped, routed and permission-guarded, and the
// sidebar had no entry for any of them. "Surveillance" resolved as a SEARCH
// TERM — because the permission module was registered in the matrix — so the
// owner typed it, the sidebar answered "لا توجد نتائج مطابقة", and there was
// no way to open the feature at all.
//
// Every other guard passed. The routes existed. The permissions existed. The
// translations shipped. Nothing was broken except that the front door was
// missing, and no test looked for a door.
//
// Phase 1 deliberately shipped no sidebar entry because it shipped no pages.
// That was right then and became wrong the moment pages existed, which is
// exactly the kind of deferred decision that never gets revisited without a
// test to force it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const RBAC = read("src/modules/permissions/lib/rbacStore.js");
const APP = read("src/App.jsx");
const NAV = read("src/i18n/navigation.js");
const EN = JSON.parse(read("src/locales/en/common.json"));
const AR = JSON.parse(read("src/locales/ar/common.json"));

/** The Surveillance Center block, isolated from the rest of the sidebar. */
const section = (() => {
  const start = RBAC.indexOf('title: "Surveillance Center"');
  assert.ok(start > 0, "there is no Surveillance Center section in SIDEBAR_SECTIONS");
  const end = RBAC.indexOf("},", RBAC.indexOf("],", start));
  return RBAC.slice(start, end);
})();

const entries = [...section.matchAll(/\{\s*label:\s*"([^"]+)",\s*to:\s*"([^"]+)",\s*permission:\s*"([^"]+)"/g)]
  .map(([, label, to, permission]) => ({ label, to, permission }));

/* ------------------------------------------------------------------ *
 * A door for every room
 * ------------------------------------------------------------------ */

test("the sidebar has exactly ONE surveillance row", () => {
  // Eleven flat rows for one feature pushed every other module off the screen.
  // The sidebar answers "which part of the business am I in"; everything below
  // /surveillance is a "where inside it" question, which only exists once you
  // are already there.
  assert.equal(entries.length, 1, `expected 1 sidebar row, found ${entries.length}`);
  assert.equal(entries[0].to, "/surveillance");
});

test("every routed page is reachable from the in-page tab bar", () => {
  // The reachability guarantee MOVED rather than disappeared. A page that is
  // routed and in neither the sidebar nor the tab bar is a page nobody can open
  // — which is the production bug this file was written for.
  const nav = read("src/modules/surveillance/components/SurveillanceNav.jsx");
  const tabs = new Set([...nav.matchAll(/to:\s*"([^"]+)"/g)].map(([, to]) => to));

  const routed = [...APP.matchAll(/path="(surveillance(?:\/[a-z-]+)?)"/g)]
    .map(([, p]) => `/${p}`)
    .filter((p) => !p.includes(":"));

  const unreachable = routed.filter((r) => !tabs.has(r) && !entries.some((e) => e.to === r));
  assert.deepEqual(unreachable, [],
    `routed but reachable from neither the sidebar nor the tab bar: ${unreachable.join(", ")}`);
});

test("the tab bar never points at a route that does not exist", () => {
  const nav = read("src/modules/surveillance/components/SurveillanceNav.jsx");
  const tabs = [...nav.matchAll(/to:\s*"([^"]+)"/g)].map(([, to]) => to);
  const dead = tabs.filter((t) => !APP.includes(`path="${t.slice(1)}"`));
  assert.deepEqual(dead, [], "tab bar links to unrouted paths");
});

test("the tab bar renders from the shared header, not per page", () => {
  // Twelve copies means the thirteenth page forgets it.
  const ui = read("src/modules/surveillance/components/SurveillanceUi.jsx");
  assert.match(ui, /<SurveillanceNav \/>/, "PageHeader must render the tab bar");
});

/* ------------------------------------------------------------------ *
 * Permissions match the route guards exactly
 * ------------------------------------------------------------------ */

test("each sidebar permission matches its route's ProtectedRoute", () => {
  // A mismatch shows the entry to someone the route then refuses, or hides it
  // from someone allowed in — both look like bugs to the person affected.
  for (const entry of entries) {
    const at = APP.indexOf(`path="${entry.to.slice(1)}"`);
    assert.ok(at > 0, `no route for ${entry.to}`);
    const guard = APP.slice(at, at + 260);
    assert.ok(guard.includes(entry.permission),
      `${entry.to}: sidebar requires "${entry.permission}" but the route guard does not`);
  }
});

test("no surveillance entry is marked adminOnly", () => {
  // Super Admin already bypasses via isAdminUser(). Marking these adminOnly
  // would additionally hide them from a user the owner had deliberately
  // granted surveillance permissions to.
  assert.doesNotMatch(section, /adminOnly:\s*true/,
    "surveillance entries should be permission-gated, not adminOnly");
});

/* ------------------------------------------------------------------ *
 * It has to read correctly in both languages
 * ------------------------------------------------------------------ */

test("the section title and every label have translation keys", () => {
  assert.match(NAV, /"Surveillance Center":\s*"sidebar\.surveillanceCenter"/,
    "the section title has no key, so Arabic would show the English string");
  for (const { label } of entries) {
    assert.ok(NAV.includes(`"${label}"`) || NAV.includes(`${label}:`),
      `no ITEM_LABEL_KEYS entry for "${label}"`);
  }
});

test("every sidebar key resolves in BOTH locales", () => {
  const keys = [...NAV.matchAll(/"sidebar\.(surveillance[A-Za-z]*)"/g)].map(([, k]) => k);
  assert.ok(keys.length >= 10, `expected the full label set, found ${keys.length}`);
  for (const key of new Set(keys)) {
    assert.ok(EN.sidebar?.[key], `en/common.json sidebar.${key} is missing`);
    assert.ok(AR.sidebar?.[key], `ar/common.json sidebar.${key} is missing`);
    // A key present but untranslated renders English to an Arabic user.
    assert.notEqual(AR.sidebar[key], EN.sidebar[key], `sidebar.${key} is identical in both locales`);
  }
});
