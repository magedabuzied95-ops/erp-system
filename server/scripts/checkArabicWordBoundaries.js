#!/usr/bin/env node
/**
 * Fails when a regex word boundary sits next to an Arabic character.
 *
 * Why this needs a guard rather than a code review: `/\bمتاح\b/` looks correct to
 * everyone who reads it. JavaScript's `\b` is defined over ASCII word characters, so
 * between two Arabic letters — or an Arabic letter and a space — the transition it
 * needs does not exist and the pattern matches nothing, ever. It fails silently, in
 * the safe-looking direction: a normalizer that rewrites nothing, a detector that
 * never fires, an assertion that always passes.
 *
 * This repo accumulated twelve of them across five files before anyone noticed, and
 * they were only found because product search kept missing Arabic-spelled brands.
 *
 * The fix is a Unicode-aware lookaround:
 *   BAD   /\bنايك\b/
 *   GOOD  /(?<![\p{L}\p{N}])نايك(?![\p{L}\p{N}])/u
 *
 * Usage: node server/scripts/checkArabicWordBoundaries.js
 * Exits non-zero when a suspect site is found, so CI can gate on it.
 */
import fs from "node:fs";
import path from "node:path";

const ARABIC_RANGE = "\\u0600-\\u06FF";
// A literal backslash-b in the source text, adjacent to an Arabic character or to a
// \u06xx escape (this repo writes Arabic both ways).
const SUSPECT = new RegExp(
  `\\\\b(?:\\\\u06[0-9a-fA-F]{2}|[${ARABIC_RANGE}])` +
    `|(?:\\\\u06[0-9a-fA-F]{2}|[${ARABIC_RANGE}])\\\\b`
);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".claude", "backups", ".next", ".vercel",
]);
const ROOTS = ["server", "src", "tests", "scripts"];
// This file documents the bad pattern on purpose.
const ALLOWLIST = new Set([path.join("server", "scripts", "checkArabicWordBoundaries.js")]);

/**
 * Line-level comment test. Deliberately not a parser: a line whose first non-space
 * characters open a comment cannot also contain executable regex, which is all this
 * needs to decide.
 */
const isCommentLine = (line = "") => /^\s*(\/\/|\/\*|\*)/.test(line);

const hits = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|jsx|mjs|cjs|ts|tsx)$/.test(entry.name)) continue;
    const relative = path.relative(process.cwd(), full);
    if (ALLOWLIST.has(relative)) continue;
    fs.readFileSync(full, "utf8")
      .split(/\r?\n/)
      .forEach((line, index) => {
        // Comments explaining the trap are not the trap. Without this the guard flags
        // its own documentation and the fix notes left at each repaired site.
        if (isCommentLine(line)) return;
        if (SUSPECT.test(line)) hits.push({ file: relative, line: index + 1, text: line.trim().slice(0, 160) });
      });
  }
};

for (const root of ROOTS) {
  if (fs.existsSync(root)) walk(path.resolve(root));
}

if (!hits.length) {
  console.log("arabic-word-boundary check: clean");
  process.exit(0);
}

console.error(`arabic-word-boundary check: ${hits.length} suspect site(s)\n`);
console.error("\\b cannot match next to an Arabic letter — these patterns never fire.");
console.error("Use a Unicode lookaround instead: (?<![\\p{L}\\p{N}])WORD(?![\\p{L}\\p{N}]) with the u flag.\n");
for (const hit of hits) console.error(`  ${hit.file}:${hit.line}\n      ${hit.text}`);
process.exit(1);
