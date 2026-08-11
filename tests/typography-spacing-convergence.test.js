import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Typography, spacing and control-sizing convergence.
//
// These guards are written to stop NEW drift, not to forbid specialised UI. A
// print label, a chat bubble and a KPI headline all legitimately break the
// scale; what must not happen is a fresh screen quietly inventing a seventh
// button height or a Latin-only font stack.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};
const files = walk("src");

// Surfaces that legitimately sit outside the app scale, each already a
// documented exclusion from the convergence phases: print and label layouts
// (physical measurements), export/PDF templates, the storefront and AiInbox
// (frozen), POS transactional internals, and the two self-contained prototypes
// that own their stylesheet.
const EXEMPT = (f) =>
  /BarcodeLabels|thermal|invoicePdf|Export\.js|storefront\/|aiSupport\/(pages\/AiInbox|components)|DashboardPrototype|ThemeFoundation|modules\/pos\//i.test(f);

// A JSX opening tag can contain `>` inside an arrow function, so a naive
// [^>]* match truncates it. This walks braces instead.
const openingTags = (src, names) => {
  const out = [];
  const re = new RegExp(`<(${names.join("|")})\\b`, "g");
  let m;
  while ((m = re.exec(src))) {
    let depth = 0;
    for (let j = m.index; j < src.length; j += 1) {
      const c = src[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) {
        out.push(src.slice(m.index, j + 1));
        break;
      }
    }
  }
  return out;
};

// ---- the scale exists and is token-driven ---------------------------------

test("the typography scale lives in the token layer, not in a stylesheet", () => {
  const themes = read("src/theme/themes.js");
  for (const step of ["caption", "label", "body", "section-title", "page-title", "display"]) {
    assert.match(themes, new RegExp(`"font-${step}":`), `missing size token for ${step}`);
    assert.match(themes, new RegExp(`"font-${step}-lh":`), `missing line-height token for ${step}`);
  }
});

test("every typography class reads its size and line height from tokens", () => {
  const css = read("src/theme/foundation.css");
  for (const step of ["caption", "label", "body", "section-title", "page-title", "display"]) {
    const rule = css.match(new RegExp(`\\.m1-${step} \\{[^}]*\\}`))?.[0];
    assert.ok(rule, `.m1-${step} is missing`);
    assert.match(rule, /font-size: var\(--font-/, `.m1-${step} hardcodes a size`);
    assert.match(rule, /line-height: var\(--font-/, `.m1-${step} hardcodes a line height`);
  }
});

test("Arabic keeps its vertical room at every step", () => {
  // Arabic ascenders and diacritics need more room than a Latin-first scale
  // allows. Nothing may drop below 1.2, and body must stay generous.
  const themes = read("src/theme/themes.js");
  const heights = [...themes.matchAll(/"font-[\w-]+-lh": "([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(heights.length >= 6, "expected a line height per step");
  assert.ok(Math.min(...heights) >= 1.2, `a step drops to ${Math.min(...heights)} — diacritics will clip`);
  assert.match(themes, /"font-body-lh": "1\.55"/, "body must stay at the readable 1.55");
});

// ---- no new drift ---------------------------------------------------------

test("no new near-duplicate font sizes creep back in", () => {
  // The tail (8.5 / 9.5 / 10.5 / 12.75 / 17 / 19 / 22 / 23 / 25 / 27px …) is
  // what made two adjacent screens never match. Fractional sizes and off-scale
  // values in app code are the specific thing being prevented.
  const STEPS = new Set([9, 10, 11, 12, 13, 14, 15, 16, 20, 24, 28, 34]);
  const offenders = [];
  for (const file of files) {
    if (!/\.(jsx?|css)$/.test(file) || EXEMPT(file)) continue;
    for (const match of read(file).match(/\btext-\[([0-9.]+)px\]/g) ?? []) {
      const value = Number(match.match(/([0-9.]+)/)[1]);
      if (value < 9) continue; // deliberate micro-labels
      if (!STEPS.has(value)) offenders.push(`${file}: ${match}`);
    }
  }
  assert.deepEqual(offenders, [], "off-scale font size");
});

test("no new page-specific font family without an Arabic fallback", () => {
  // The one that was fixed: .dashboard-premium h1 used a Latin-only stack, so an
  // Arabic heading fell through to a generic sans. App CSS should name the
  // canonical family; print/thermal templates legitimately do not.
  const offenders = [];
  for (const file of files) {
    if (!file.endsWith(".css") || EXEMPT(file)) continue;
    const src = read(file);
    for (const decl of src.match(/font-family:\s*[^;]+;/g) ?? []) {
      if (/var\(--|inherit|monospace/.test(decl)) continue;
      if (/Cairo|Tajawal|Noto Sans Arabic/.test(decl)) continue; // Arabic-aware
      offenders.push(`${file}: ${decl.trim().slice(0, 70)}`);
    }
  }
  // Known, intentional: the WhatsApp-style chat surfaces imitate a chat client.
  const unexpected = offenders.filter((o) => !/EmployeePayrollPortal\.m1\.css|EmployeeChatInbox\.m1\.css/.test(o));
  assert.deepEqual(unexpected, [], "page-specific font stack with no Arabic fallback");
});

// ---- control sizing -------------------------------------------------------

test("generic control heights come from the control-height tokens", () => {
  // Buttons, inputs and selects used SIX heights (h-7..h-12) while the token
  // layer had said sm/md/lg since Phase 1. Small sizes (icon-only controls,
  // checkboxes) and tall ones (textareas) are legitimately off-scale.
  const offenders = [];
  for (const file of files) {
    if (!/\.jsx?$/.test(file) || EXEMPT(file)) continue;
    for (const tag of openingTags(read(file), ["button", "input", "select"])) {
      for (const cls of tag.match(/\b(?:min-h|h)-(\d+)\b/g) ?? []) {
        const n = Number(cls.match(/(\d+)$/)[1]);
        if (n <= 6 || n >= 13) continue; // icon-sized, or a tall/auto surface
        offenders.push(`${file}: ${cls}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "generic control height that bypasses the token scale");
});

test("the three control steps are the only ones in use", () => {
  const used = new Set();
  for (const file of files) {
    if (!/\.jsx?$/.test(file)) continue;
    for (const m of read(file).match(/(?:min-h|h)-\[var\(--control-height(?:-(?:sm|md|lg))?\)\]/g) ?? []) used.add(m);
  }
  const steps = new Set([...used].map((u) => u.match(/control-height(?:-(\w+))?/)[1] ?? "md"));
  assert.ok(steps.size <= 3, `expected sm/md/lg, found ${[...steps].join(", ")}`);
  assert.ok(used.size > 0, "the control tokens should actually be adopted");
});

test("control tokens keep accessible touch targets, including on mobile", () => {
  const themes = read("src/theme/themes.js");
  const sm = Number(themes.match(/"control-height-sm": "(\d+)px"/)[1]);
  const lg = Number(themes.match(/"control-height-lg": "(\d+)px"/)[1]);
  assert.ok(sm >= 32, `smallest control is ${sm}px`);
  assert.ok(lg >= 44, `largest control is ${lg}px`);
  // and the mobile override grows md rather than shrinking it
  assert.match(read("src/theme/foundation.css"), /--control-height-md:\s*42px/);
});

// ---- layout rhythm --------------------------------------------------------

test("the layout rhythm classes consume the existing spacing scale", () => {
  // themes.js has shipped --space-1..8 since Phase 1 with nothing using it.
  // These classes are the adoption surface; a second spacing system is not.
  const css = read("src/theme/foundation.css");
  for (const cls of ["m1-page-body", "m1-section", "m1-stack", "m1-card-padding"]) {
    const rule = css.match(new RegExp(`\\.${cls} \\{[^}]*\\}`))?.[0];
    assert.ok(rule, `.${cls} is missing`);
    assert.match(rule, /var\(--space-\d\)/, `.${cls} must use the canonical spacing scale`);
  }
});

test("the rhythm is RTL-safe and tightens rather than reflows on mobile", () => {
  const css = read("src/theme/foundation.css");
  const block = css.slice(css.indexOf(".m1-page-body"));
  for (const physical of ["padding-left", "padding-right", "margin-left", "margin-right"]) {
    assert.ok(!block.includes(physical), `rhythm uses ${physical} instead of a logical property`);
  }
  assert.match(css, /@media \(max-width: 767px\) \{[\s\S]*\.m1-page-body \{ gap: var\(--space-4\)/);
});

// ---- what must not have moved ---------------------------------------------

test("Manager MiniMetric keeps its oversized headline", () => {
  // Expressed in rem, so the px snap could never reach it — but this is the
  // third phase in which something has proposed shrinking it.
  const src = read("src/modules/managerPortal/pages/ManagerPortal.jsx");
  assert.match(src, /text-\[1\.9rem\]/);
  assert.match(src, /sm:text-\[2\.05rem\]/);
});

test("no !important was added by this phase", () => {
  // Scoped to the two blocks this phase added. foundation.css also carries an
  // older legacy-colour cleanup block further down that legitimately uses it.
  const foundation = read("src/theme/foundation.css");
  const start = foundation.indexOf("CANONICAL TYPOGRAPHY SCALE");
  const end = foundation.indexOf(".m1-card-padding--compact");
  assert.ok(start > -1 && end > start, "the canonical blocks moved");
  assert.doesNotMatch(foundation.slice(start, end), /!important/, "the canonical layer must win by cascade, not force");
});
