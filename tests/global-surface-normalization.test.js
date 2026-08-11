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

// ---------------------------------------------------------------------------
// Step 4 — Manager Portal shared surface sources
//
// Scope boundary for this phase: white/slate/navy are SURFACES and become
// tokens; blue/cyan/sky were the wrong accent for a gold product and become
// --primary; emerald/amber/rose are genuine STATUS hues and are left alone.
// ---------------------------------------------------------------------------

const manager = read("src/modules/managerPortal/pages/ManagerPortal.jsx");

// Comments are stripped: several of these components carry a note quoting the
// fixed colour they used to hardcode, and that must not read as a violation.
//
// The `\/\*` is anchored to line-start / whitespace / `{` on purpose. A bare
// /\/\*[\s\S]*?\*\// also matches the `/*` inside `accept="image/*"`, and then
// runs to the next real `*/` — in CreateProduct that silently deleted ~300 lines
// of markup from the text under test and turned these assertions green by
// deleting their evidence.
const stripComments = (s) =>
  s.replace(/^\s*\/\/.*$/gm, "").replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, "$1");

const component = (src, name) => {
  const start = src.indexOf(`const ${name} = (`);
  assert.ok(start > -1, `Manager primitive \`${name}\` not found — has the seam moved?`);
  const body = src.slice(start + 1);
  const end = body.indexOf("\nconst ");
  return stripComments(end > -1 ? body.slice(0, end) : body.slice(0, 2600));
};

const SURFACE_NEUTRALS =
  /\b(?:bg|border|border-t|text)-(?:white|slate|gray|zinc|neutral|stone)-\d|\bbg-white\b|\btext-white\b/;
const FIXED_NAVY = /#0f172a|#0b1120|#f8fafc|#ffffff|#eef2f7|#e2e8f0|linear-gradient\(180deg,#/;

for (const name of ["Badge", "Card", "MiniMetric", "CompactStatCard", "EmptyState"]) {
  test(`Manager \`${name}\` no longer carries a fixed surface model`, () => {
    const s = component(manager, name);
    assert.doesNotMatch(s, FIXED_NAVY, `${name} still hardcodes a fixed light/dark surface colour`);
    assert.doesNotMatch(s, SURFACE_NEUTRALS, `${name} still hardcodes a neutral surface utility`);
  });
}

// ---- the two contracts that must NOT converge ----------------------------

test("MiniMetric keeps its oversized headline KPI typography", () => {
  const s = component(manager, "MiniMetric");
  // 1.9rem/2.05rem is LARGER than MetricCard comfortable (25px) and far larger
  // than compact (20px). Mapping this onto MetricCard shrinks Manager KPIs by a
  // third — it has been proposed and rejected twice.
  assert.match(s, /text-\[1\.9rem\]/);
  assert.match(s, /sm:text-\[2\.05rem\]/);
  assert.doesNotMatch(s, /<MetricCard/, "MiniMetric must not be swapped for MetricCard");
});

test("Manager Badge stays dot-free", () => {
  const s = component(manager, "Badge");
  // M1UI StatusBadge renders a leading <i> dot with gap:6px. Manager Badge never
  // had one, so it is not a StatusBadge and must not become one here.
  assert.doesNotMatch(s, /<StatusBadge/, "Manager Badge must not be swapped for StatusBadge");
  assert.doesNotMatch(s, /<i\b/, "a leading dot would change the Badge's composition");
  assert.match(s, /<span /);
});

test("Manager per-tone tinting keeps the data-tone hooks index.css targets", () => {
  for (const name of ["Card", "MiniMetric", "CompactStatCard"]) {
    assert.match(component(manager, name), /data-tone=\{tone\}/, `${name} dropped data-tone`);
  }
});

test("the Manager page shell is a token surface, not a fixed gradient", () => {
  assert.match(manager, /manager-portal-shell \$\{[^}]*\}[^`"]*\bbg-background\b/);
  assert.doesNotMatch(manager, /linear-gradient\(180deg,#f8fafc/, "the fixed-light page ramp is back");
});

test("the ManagerPortal paint-over shim is still present for the un-migrated call sites", () => {
  const shim = read("src/modules/managerPortal/pages/ManagerPortal.m1.css");
  assert.match(shim, /\.manager-portal-shell/);
});

// ---------------------------------------------------------------------------
// Step 5 — CreateProduct fixed-dark surface model
//
// CreateProduct had no shared surface constant to migrate: it was ~480 fixed-DARK
// utilities (bg-zinc-950, bg-[#10172a], border-white/10, text-white, text-zinc-*)
// spread across 4,277 lines with ZERO `dark:` variants — a page hard-wired to a
// dark theme inside an app that ships a light one. The whole page is the seam,
// so it was swept as one coherent surface system.
// ---------------------------------------------------------------------------

const createProduct = read("src/modules/products/pages/CreateProduct.jsx");
const createProductCode = stripComments(createProduct);

test("CreateProduct no longer hardcodes a fixed-dark surface palette", () => {
  const leftovers = createProductCode.match(
    /\b(?:bg|text|border|ring|divide)-(?:zinc|slate|gray|neutral|stone)-\d+(?:\/[\d.[\]]+)?/g,
  );
  assert.equal(leftovers, null, `fixed-dark neutrals survived: ${[...new Set(leftovers ?? [])].join(", ")}`);
});

test("CreateProduct has no raw hex or rgb colours left", () => {
  const raw = createProductCode.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/g);
  assert.equal(raw, null, `raw colours survived: ${[...new Set(raw ?? [])].join(", ")}`);
});

test("CreateProduct's translucent white surfaces and borders are tokens", () => {
  assert.doesNotMatch(createProductCode, /\bbg-white\/[\d.[\]]/, "bg-white/N is a fixed surface");
  assert.doesNotMatch(createProductCode, /\bborder-white\/[\d.[\]]/, "border-white/N is a fixed border");
  assert.doesNotMatch(createProductCode, /\bring-white\/[\d.[\]]/, "ring-white/N is a fixed ring");
});

test("CreateProduct keeps exactly the white fills that are NOT surfaces", () => {
  // Open Graph / product image mattes (product photography is shot on white) and
  // the barcode bars, whose white-on-black contrast is a scannability contract.
  // A future sweep must not "finish the job" by theming these.
  // 4 image mattes + 1 barcode bar + the toggle knob.
  const plainWhite = createProductCode.match(/\bbg-white(?![-/\w])/g) ?? [];
  assert.equal(plainWhite.length, 6, `expected the 6 deliberate white fills, found ${plainWhite.length}`);
  assert.match(createProduct, /Deliberate white matte, NOT a surface/);
  assert.match(createProduct, /Barcode bars/);
});

test("CreateProduct's toggle off-track stays visible under the plain-white knob", () => {
  // bg-surface-soft here would leave a white knob on a near-white track in the
  // light theme. border-strong reads in both.
  assert.match(createProduct, /"bg-emerald-400" : "bg-\[var\(--border-strong\)\]"/);
});

test("CreateProduct's elevation is token-driven, not tuned for a black page", () => {
  assert.doesNotMatch(createProductCode, /shadow-\[0[^\]]*rgba\(/, "a fixed-dark drop shadow survived");
  assert.match(createProduct, /shadow-\[var\(--shadow-card\)\]/);
  assert.match(createProduct, /shadow-\[var\(--shadow-overlay\)\]/);
});

test("text-white survives ONLY where it is a foreground on a saturated status fill", () => {
  const SATURATED =
    /\b(?:bg|from|via|to)-(?:emerald|teal|green|amber|orange|rose|red|sky|cyan|blue|indigo|violet|purple|fuchsia|pink)-\d/;
  for (const line of createProductCode.split("\n")) {
    if (!/\btext-white\b/.test(line)) continue;
    assert.ok(SATURATED.test(line), `text-white on a non-fill line is fixed-dark debt:\n${line.trim()}`);
  }
});

// ---------------------------------------------------------------------------
// Step 6 — Employee Portal
//
// Inspected last, and it DID carry genuine debt: unlike the other three it has
// no .m1.css shim, no `dark:` variants and no var(--) usage, so its fixed-light
// surfaces were rendering exactly as written with nothing correcting them.
// ---------------------------------------------------------------------------

const employee = read("src/modules/employees/pages/EmployeePortal.jsx");
const employeeCode = stripComments(employee);

test("EmployeePortal has no fixed-light surface utilities left", () => {
  const leftovers = employeeCode.match(/\b(?:bg|border|ring)-(?:slate|gray|zinc|neutral|stone)-\d+/g);
  assert.equal(leftovers, null, `fixed-light surfaces survived: ${[...new Set(leftovers ?? [])].join(", ")}`);
  assert.doesNotMatch(employeeCode, /\btext-slate-\d/, "fixed-light text survived");
});

test("EmployeePortal's inverted hero uses the topbar token pair, not slate-950", () => {
  // The dark hero / install banner / primary actions are deliberate inverted
  // surfaces. themes.js ships --topbar / --topbar-text for precisely that, so
  // they keep the design intent AND follow the theme.
  assert.match(employee, /bg-\[var\(--topbar\)\] text-\[var\(--topbar-text\)\]/);
  const inverted = employee.match(/bg-\[var\(--topbar\)\]/g) ?? [];
  assert.equal(inverted.length, 4, `expected hero + banner + 2 primary actions, found ${inverted.length}`);
});

test("EmployeePortal's remaining white utilities are translucency over the dark hero", () => {
  // bg-white/10 and text-white/70 on a guaranteed-dark surface are correct; a
  // bare bg-white would not be.
  assert.doesNotMatch(employeeCode, /\bbg-white\b(?![/-])/, "an opaque white surface survived");
  for (const line of employeeCode.split("\n")) {
    if (!/\btext-white\b(?![/-])/.test(line)) continue;
    assert.ok(
      // bg-white/N, border-white/N and the topbar token are all reliable markers
      // that the element sits on the inverted surface; a saturated fill speaks
      // for itself.
      /bg-\[var\(--topbar\)\]|\b(?:bg|border)-white\/|\bbg-(?:emerald|red|rose|amber|orange|green)-\d/.test(line),
      `bare text-white outside an inverted or saturated fill:\n${line.trim()}`,
    );
  }
});

test("the CreateProduct submit-safety boundary is untouched by the sweep", () => {
  // b43b74c. The canonical Button defaults to type="button"; losing any of these
  // three breaks product creation silently. tests/create-product-submit-safety
  // is the real guard — this is a tripwire so a surface sweep cannot drift past it.
  assert.equal((createProduct.match(/type="submit"/g) ?? []).length, 3);
  assert.equal((createProduct.match(/<form\b/g) ?? []).length, 1);
});
