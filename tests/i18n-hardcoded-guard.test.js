/**
 * Hardcoded UI-string guard.
 *
 * Existing localization debt is baselined in
 * tests/fixtures/i18n-hardcoded-baseline.json. The guard blocks NEW debt:
 *
 *   - a file that gains hardcoded UI strings fails
 *   - a file that is not in the baseline and has any fails
 *   - the totals may only shrink
 *
 * After removing debt, regenerate the baseline:
 *   node scripts/i18n-audit.mjs --write-baseline
 *
 * The scanner (scripts/i18n-scan.mjs) deliberately ignores business data, API
 * and enum values, technical identifiers, brand names, and logs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const baselinePath = path.join(repoRoot, "tests", "fixtures", "i18n-hardcoded-baseline.json");

const scanner = await import(pathToFileURL(path.join(repoRoot, "scripts", "i18n-scan.mjs")).href);

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const { results } = scanner.scanRepository();
const summary = scanner.summarise(results);
const current = new Map(results.map((entry) => [entry.file, entry]));

const REGENERATE = "Regenerate with: node scripts/i18n-audit.mjs --write-baseline";

test("no file gains hardcoded UI strings", () => {
  const regressions = [];
  for (const [file, entry] of current) {
    const allowed = baseline.files[file];
    if (!allowed) {
      regressions.push(
        `${file}: NEW file with ${entry.total} hardcoded UI string(s) (ar:${entry.arabic} en:${entry.english}). ` +
          `First: line ${entry.hits[0].line} "${entry.hits[0].value}"`
      );
      continue;
    }
    if (entry.arabic > allowed.arabic) {
      regressions.push(`${file}: hardcoded Arabic went ${allowed.arabic} -> ${entry.arabic}`);
    }
    if (entry.english > allowed.english) {
      regressions.push(`${file}: hardcoded English went ${allowed.english} -> ${entry.english}`);
    }
  }
  assert.deepEqual(
    regressions,
    [],
    `New localization debt detected. Use t("branch.key") with entries in BOTH src/locales/ar and src/locales/en.\n- ${regressions
      .slice(0, 40)
      .join("\n- ")}`
  );
});

test("the localization debt baseline only shrinks", () => {
  const grown = [];
  for (const metric of ["arabic", "english", "total"]) {
    if (summary[metric] > baseline.totals[metric]) {
      grown.push(`${metric}: ${baseline.totals[metric]} -> ${summary[metric]}`);
    }
  }
  assert.deepEqual(grown, [], `Total localization debt grew.\n- ${grown.join("\n- ")}`);
});

test("the baseline has no stale entries", () => {
  // A baselined file that no longer has debt (or no longer exists) must be
  // dropped, otherwise the ratchet silently loosens.
  const stale = [];
  for (const [file, allowed] of Object.entries(baseline.files)) {
    const entry = current.get(file);
    if (!entry) {
      stale.push(`${file}: clean now (baseline still allows ${allowed.total})`);
      continue;
    }
    if (entry.arabic < allowed.arabic) stale.push(`${file}: Arabic ${allowed.arabic} -> ${entry.arabic}`);
    if (entry.english < allowed.english) stale.push(`${file}: English ${allowed.english} -> ${entry.english}`);
  }
  assert.deepEqual(stale, [], `Localization debt was reduced — tighten the baseline. ${REGENERATE}\n- ${stale.slice(0, 40).join("\n- ")}`);
});
