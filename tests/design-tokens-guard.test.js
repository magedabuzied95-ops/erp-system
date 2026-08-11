import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// M1 design system — Phase 1 guard.
//
// Goal: stop NEW legacy colour debt without demanding the ~2,126 existing
// occurrences be fixed first. Files that already contained legacy utilities when
// Phase 1 landed are baselined; the guard only fails when a file that was clean
// gains one, or when a brand-new file ships with them.
//
// Dependency-free and uses the repo's existing node:test convention, so it runs
// in CI with everything else.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "src");
const BASELINE_FILE = path.join(root, "tests", "fixtures", "legacy-color-baseline.txt");

const LEGACY_FAMILIES = ["blue", "sky", "cyan", "indigo"];
const UTILITY_PREFIXES = "bg|text|border|ring|from|to|via|shadow|fill|stroke|divide|outline|decoration|accent|caret|placeholder";
const LEGACY_UTILITY = new RegExp(`\\b(?:${UTILITY_PREFIXES})-(?:${LEGACY_FAMILIES.join("|")})-[0-9]{2,3}`, "g");

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.(jsx?|tsx?|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const relative = (file) => path.relative(root, file).split(path.sep).join("/");

const readBaseline = () => {
  if (!fs.existsSync(BASELINE_FILE)) return new Set();
  return new Set(
    fs.readFileSync(BASELINE_FILE, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
};

const offenders = () => {
  const found = new Map();
  for (const file of walk(SRC)) {
    const matches = fs.readFileSync(file, "utf8").match(LEGACY_UTILITY);
    if (matches?.length) found.set(relative(file), matches.length);
  }
  return found;
};

test("no NEW file introduces legacy blue/sky/cyan/indigo utilities", () => {
  const baseline = readBaseline();
  const current = offenders();
  const added = [...current.keys()].filter((file) => !baseline.has(file));

  assert.deepEqual(
    added,
    [],
    added.length
      ? [
          "",
          "Legacy colour utilities found in file(s) that were previously clean:",
          ...added.map((f) => `  - ${f} (${current.get(f)} occurrence(s))`),
          "",
          "M1 uses semantic design tokens, not palette colours. Use the token",
          "utilities exposed by the @theme bridge in src/index.css:",
          "  bg-surface / bg-surface-raised / bg-background",
          "  text-text / text-text-muted / text-text-subtle",
          "  border-border / border-border-strong",
          "  bg-primary / text-primary-foreground / bg-primary-subtle",
          "  bg-success|warning|danger|info (+ -subtle variants)",
          "",
          "The brand colour lives in src/theme/themes.js and must stay",
          "re-pointable centrally. If an occurrence is genuinely semantic (for",
          "example a third-party brand mark), add the file to",
          "tests/fixtures/legacy-color-baseline.txt with a justification in the PR.",
          "",
        ].join("\n")
      : undefined
  );
});

test("the baseline only lists files that still have legacy colours", () => {
  // Keeps the baseline shrinking as later phases migrate files: once a file is
  // cleaned it must drop out, so it can never silently regress.
  const baseline = readBaseline();
  const current = offenders();
  const stale = [...baseline].filter((file) => !current.has(file));
  assert.deepEqual(
    stale,
    [],
    stale.length
      ? `These files no longer contain legacy colours — remove them from tests/fixtures/legacy-color-baseline.txt so they stay clean:\n${stale.map((f) => `  - ${f}`).join("\n")}`
      : undefined
  );
});

test("the baseline is a real snapshot, not an empty escape hatch", () => {
  const baseline = readBaseline();
  assert.ok(baseline.size > 0, "baseline file is missing or empty");
  assert.ok(baseline.size < 400, "baseline has grown implausibly large — debt should shrink, not grow");
});

// ---- the token bridge itself --------------------------------------------

const indexCss = fs.readFileSync(path.join(SRC, "index.css"), "utf8");

test("Tailwind can reach the design tokens", () => {
  // Before Phase 1 there was no bridge at all: this project is Tailwind v4, and
  // tailwind.config.js is never loaded (no @config directive), so its
  // theme.extend was inert and no `bg-primary` utility existed.
  assert.match(indexCss, /@theme inline \{/);
  for (const token of [
    "--color-background", "--color-surface", "--color-surface-raised",
    "--color-text", "--color-text-muted", "--color-border", "--color-border-strong",
    "--color-primary", "--color-primary-foreground", "--color-primary-subtle",
    "--color-success", "--color-warning", "--color-danger", "--color-info",
  ]) {
    assert.ok(indexCss.includes(token), `missing token bridge: ${token}`);
  }
});

test("the bridge maps to variables and never hardcodes a colour", () => {
  const block = indexCss.slice(indexCss.indexOf("@theme inline {"), indexCss.indexOf("@layer base {"));
  const hardcoded = block.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g);
  assert.equal(hardcoded, null, `the bridge must reference var(--…) only, found: ${hardcoded}`);
  assert.match(block, /--color-primary: var\(--primary\);/);
});

test("the bridge is `inline` so runtime theme switching keeps working", () => {
  // Plain @theme would snapshot values at build time and break ThemeProvider's
  // per-theme / per-density variable writes.
  assert.match(indexCss, /@theme inline/);
  assert.doesNotMatch(indexCss, /@theme \{/);
});

test("brand colour stays centrally re-pointable", () => {
  const themes = fs.readFileSync(path.join(SRC, "theme", "themes.js"), "utf8");
  assert.match(themes, /primary: "#[0-9a-fA-F]{6}"/);
  // no component should need editing to change the brand
  assert.match(indexCss, /--color-primary: var\(--primary\)/);
});

test("no bridged variable is self-referential", () => {
  // `--x: var(--x)` is circular and silently invalidates a real runtime
  // variable. Tailwind's shadow namespace collides with themes.js's
  // --shadow-card / --shadow-overlay, which is why shadows are not bridged.
  const block = indexCss
    .slice(indexCss.indexOf("@theme inline {"), indexCss.indexOf("@layer base {"))
    .replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments — they document the trap by name
  for (const [, name, ref] of block.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\)/g)) {
    assert.notEqual(name, ref, `circular token: ${name} references itself`);
  }
});
