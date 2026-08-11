import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Global Surface Normalization.
//
// Three competing surface models used to coexist in this codebase:
//   1. theme-aware semantic surfaces (M1UI, the main ERP shell)
//   2. fixed-LIGHT   — SettingsCenter `shellCard`, ManagerPortal Card/Badge/MiniMetric
//   3. fixed-DARK    — CreateProduct, ManagerPortal CompactStatCard
//
// Migrating any component before its parent surface was normalized regressed
// every time, because the child asked the theme what colour to be while the
// parent had already decided. These tests lock the SHARED SURFACE SOURCES to
// model 1 — the single seam each set of call sites reads from.
//
// They deliberately assert on the source constants, not on call sites: the whole
// point of the phase is that the call sites did not have to change.

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// A surface constant is normalized when it names semantic tokens and carries no
// hand-written `dark:` counterpart — the token itself is what flips.
const FIXED_LIGHT = /\b(bg|border|text)-(white|slate|gray|zinc|neutral|stone)-/;
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

const constant = (src, name) => {
  const m = new RegExp(`^const ${name} = "([^"]*)";`, "m").exec(src);
  assert.ok(m, `shared surface constant \`${name}\` not found — has the seam moved?`);
  return m[1];
};

// ---------------------------------------------------------------------------
// Step 3 — SettingsCenter shared surface source
// ---------------------------------------------------------------------------

const settings = read("src/modules/settings/pages/SettingsCenter.jsx");

const SETTINGS_SURFACES = [
  "shellCard",
  "fieldSurface",
  "subtleSurface",
  "headingText",
  "bodyText",
  "mutedText",
  "inputClass",
];

for (const name of SETTINGS_SURFACES) {
  test(`SettingsCenter \`${name}\` is a theme-aware semantic surface`, () => {
    const value = constant(settings, name);
    assert.doesNotMatch(value, FIXED_LIGHT, `${name} still hardcodes a fixed-light palette`);
    assert.doesNotMatch(value, RAW_COLOUR, `${name} still hardcodes a raw colour`);
    assert.doesNotMatch(
      value,
      /\bdark:/,
      `${name} still carries a hand-written dark: counterpart — that is a second surface model`,
    );
  });
}

test("SettingsCenter shellCard is still the single surface source for all its consumers", () => {
  // 1 definition + the consumers. If this drops, someone inlined the surface.
  const uses = settings.match(/\bshellCard\b/g) ?? [];
  assert.ok(uses.length >= 15, `expected shellCard to stay shared, found ${uses.length} references`);
});

test("SettingsCenter inputs no longer carry the legacy sky/blue focus treatment", () => {
  const value = constant(settings, "inputClass");
  assert.doesNotMatch(value, /sky-|blue-/, "legacy focus palette");
  assert.match(value, /focus:border-primary/);
  assert.match(value, /focus:ring-\[color:var\(--focus-ring\)\]/);
});

test("the SettingsCenter paint-over shim is still present for the un-migrated call sites", () => {
  // ~470 legacy utility occurrences remain at individual call sites in this
  // file. SettingsCenter.m1.css is still their safety net; deleting it before
  // those call sites migrate would regress them to slate/blue.
  const shim = read("src/modules/settings/pages/SettingsCenter.m1.css");
  assert.match(shim, /\.m1-settings-center/);
  assert.match(settings, /import ".\/SettingsCenter\.m1\.css"/);
});
