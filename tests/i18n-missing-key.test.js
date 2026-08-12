/**
 * Missing-key guard.
 *
 * i18next is configured with a humanising fallback: an unknown key renders as a
 * title-cased version of its last segment. That is good for resilience and
 * terrible for detection — the Arabic UI quietly shows English words like
 * "Today" or "Payment Status" and nothing looks broken.
 *
 * This guard resolves every LITERAL `t("...")` key in the frontend against the
 * composed dictionaries, so a key that would silently fall back fails the build
 * instead. Dynamically built keys cannot be resolved statically; their count is
 * asserted to stay bounded so they do not become the escape hatch.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const scanner = await import(pathToFileURL(path.resolve(process.cwd(), "scripts", "i18n-keys.mjs")).href);

const { used, dynamic } = await scanner.collectUsedKeys();
const dictionaries = await scanner.loadDictionaryKeys();

test("every literal translation key resolves in every locale", () => {
  const unresolved = [];
  for (const [key, usedIn] of used) {
    const absentIn = Object.keys(dictionaries).filter((locale) => !scanner.resolves(key, dictionaries[locale]));
    if (absentIn.length) unresolved.push(`${key} (missing in ${absentIn.join(", ")}) — ${[...usedIn][0]}`);
  }
  assert.deepEqual(
    unresolved,
    [],
    `${unresolved.length} translation key(s) have no dictionary entry and would render a humanised English fallback:\n- ${unresolved
      .slice(0, 60)
      .join("\n- ")}`
  );
});

test("the humanising fallback never leaks a raw dotted key", () => {
  // Mirrors readableMissingKeyFallback in src/i18n/i18n.js.
  const fallback = (key = "") =>
    String(key)
      .split(".")
      .pop()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase());

  for (const key of ["orders.table.paymentStatus", "common.noData", "a.b.c_d"]) {
    const rendered = fallback(key);
    assert.ok(!rendered.includes("."), `fallback for "${key}" leaked a dotted key: ${rendered}`);
    assert.ok(rendered.length > 0, `fallback for "${key}" was empty`);
  }
});

test("dynamically built translation keys stay bounded", () => {
  // Raising this ceiling means more keys escape static verification. Prefer a
  // lookup table of literal keys over t(`branch.${value}`).
  const CEILING = 60;
  assert.ok(
    dynamic <= CEILING,
    `${dynamic} dynamic t(\`...\`) call sites exceed the ceiling of ${CEILING}. Dynamic keys cannot be verified by the missing-key guard.`
  );
});
