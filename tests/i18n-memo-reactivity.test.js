/**
 * memo() reactivity guard.
 *
 * A component wrapped in memo() only re-renders when its props change. If it
 * renders translations through the module-scope tt() helper but never subscribes
 * to i18next, it keeps the PREVIOUS language after an AR<->EN switch until some
 * unrelated prop happens to change. The user sees a half-translated screen and
 * no test catches it, because the strings are correct in the dictionary.
 *
 * This guard fails when a memoized component resolves translations without
 * calling useTranslation() itself.
 *
 * It also fails when a module-scope constant resolves a translation eagerly,
 * which freezes the label in whichever language loaded first.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const SOURCE_EXTENSIONS = new Set([".jsx", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".git"]);

const walk = (dir, out = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
};

const files = walk(path.join(repoRoot, "src"));

/** `memo(Name)` / `memo(function Name` / `React.memo(...)`, excluding useMemo. */
const MEMO_RE = /(?<!use)\bmemo\(\s*(?:function\s+)?([A-Z][\w$]*)?/g;

test("memoized components that translate also subscribe to language changes", () => {
  const offenders = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    const memoMatches = [...text.matchAll(MEMO_RE)];
    if (!memoMatches.length) continue;

    // Only components that actually resolve translations are at risk.
    const translates = /\btt\(\s*"/.test(text) || /\bi18n\.t\(\s*"/.test(text);
    if (!translates) continue;

    if (!/useTranslation\(\)/.test(text)) {
      offenders.push(
        `${path.relative(repoRoot, file).split(path.sep).join("/")}: memo() component resolves translations but never calls useTranslation()`
      );
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "A memoized component that renders translations must call useTranslation() so an AR<->EN switch re-renders it:\n- " +
      offenders.join("\n- ")
  );
});

test("module-scope constants never resolve translations eagerly", () => {
  // `KEY: tt("...")` at two-space indent inside a top-level const object/array
  // is evaluated once at import time. The safe forms are `get KEY()` and storing
  // the key itself (labelKey).
  const eager = [];

  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (!/\btt\(\s*"/.test(text)) continue;
    const lines = text.split(/\r?\n/);
    let depth = 0;
    let inTopLevelConst = false;
    let isFunction = false;

    lines.forEach((line, index) => {
      if (depth === 0 && /^const\s+[A-Za-z_$][\w$]*\s*=\s*[[{]/.test(line)) {
        inTopLevelConst = true;
        isFunction = /=>|function/.test(line);
      }
      if (inTopLevelConst && !isFunction && /^\s{2,}(?!get\s)[\w"'[\]]+\s*:\s*tt\(/.test(line)) {
        eager.push(`${path.relative(repoRoot, file).split(path.sep).join("/")}:${index + 1}: ${line.trim().slice(0, 80)}`);
      }
      depth += (line.match(/[[{(]/g) || []).length - (line.match(/[\]})]/g) || []).length;
      if (inTopLevelConst && depth <= 0) {
        inTopLevelConst = false;
        depth = 0;
      }
    });
  }

  assert.deepEqual(
    eager,
    [],
    "These resolve a translation at import time and freeze the label. Use `get key() { return tt(...) }` or store the key:\n- " +
      eager.join("\n- ")
  );
});
