#!/usr/bin/env node
/**
 * Repairs Arabic literals that were written as UTF-8 bytes but decoded as CP1256
 * (windows-1256) and re-saved as UTF-8 — the classic "ط§ظ„" double-encoding.
 *
 * Cross-platform Node counterpart to `scripts/fix-arabic-mojibake.ps1` (which only
 * ever covered a hand-listed set of frontend files). This one is safe to point at
 * any file because a run is rewritten ONLY when all four hold:
 *
 *   1. Every char in the run maps to exactly ONE cp1256 byte >= 0x80 (round-trip clean).
 *   2. Those bytes decode as STRICT UTF-8 (no U+FFFD replacement chars).
 *   3. The decoded text contains Arabic letters.
 *   4. The decoded text is SHORTER than the run.
 *
 * Rule 4 is the discriminator the PowerShell version lacks: double-encoding roughly
 * doubles the char count (one Arabic char -> two mojibake chars), so a genuine
 * Arabic string can never shrink. That is what makes it safe to run over a file
 * that mixes correct Arabic with corrupted Arabic — as every AI service does.
 *
 * Usage:  node scripts/fix-arabic-mojibake.cjs <file...>
 *         node scripts/fix-arabic-mojibake.cjs --check <file...>   (report only, exit 1 if dirty)
 */
const fs = require("fs");
const path = require("path");
const iconv = require("iconv-lite");

const ARABIC = /[؀-ۿ]/;

const isMojibakeChar = (ch) => {
  if (ch.charCodeAt(0) < 0x80) return false;
  const buf = iconv.encode(ch, "win1256");
  if (buf.length !== 1 || buf[0] < 0x80) return false;
  // iconv-lite substitutes unmappable chars; require a lossless round-trip.
  return iconv.decode(buf, "win1256") === ch;
};

const decodeStrict = (buf) => {
  const out = buf.toString("utf8");
  return out.includes("�") ? null : out;
};

/**
 * Some corrupted literals store the Latin-1 half of a mojibake pair as a JS escape
 * (`"­"` — six ASCII chars) rather than the raw code point, because an editor
 * escaped the unprintable byte. That splits the run and blocks repair. The escaped
 * and raw forms are the same string VALUE, so unescaping is semantically inert —
 * but only do it where the escape actually touches a mojibake char, so unrelated
 * escapes elsewhere in the file are left exactly as the author wrote them.
 */
const unescapeAdjacentLatin1 = (source) =>
  source.replace(/\\u00([0-9a-fA-F]{2})/g, (match, hex, offset) => {
    const code = parseInt(hex, 16);
    if (code < 0x80) return match;
    const raw = String.fromCharCode(code);
    if (!isMojibakeChar(raw)) return match;
    const before = source[offset - 1] || "";
    const after = source[offset + match.length] || "";
    return isMojibakeChar(before) || isMojibakeChar(after) ? raw : match;
  });

const repairText = (rawSource) => {
  const source = unescapeAdjacentLatin1(rawSource);
  let result = "";
  let index = 0;
  const repairs = [];
  while (index < source.length) {
    if (!isMojibakeChar(source[index])) {
      result += source[index];
      index += 1;
      continue;
    }
    let end = index;
    while (end < source.length && isMojibakeChar(source[end])) end += 1;
    const run = source.slice(index, end);
    const decoded = decodeStrict(iconv.encode(run, "win1256"));
    if (decoded && ARABIC.test(decoded) && decoded.length < run.length) {
      result += decoded;
      repairs.push({ line: source.slice(0, index).split("\n").length, before: run, after: decoded });
    } else {
      result += run;
    }
    index = end;
  }
  return { result, repairs };
};

/**
 * A few literals went through the bad encode/decode cycle TWICE, so one pass only
 * peels them back to single-level mojibake. Repeat until the text stops changing.
 */
const repairFully = (source, maxPasses = 6) => {
  let current = source;
  const repairs = [];
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const outcome = repairText(current);
    if (!outcome.repairs.length) break;
    repairs.push(...outcome.repairs);
    current = outcome.result;
  }
  return { result: current, repairs };
};

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", "uploads", "backups"]);

// Accepting directories keeps the CI guard to one argument instead of blowing the
// shell's argument limit with ~1500 file paths.
const expandTargets = (inputs) => {
  const files = [];
  const visit = (target) => {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      files.push(target);
      return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        visit(path.join(target, entry.name));
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(path.join(target, entry.name));
      }
    }
  };
  inputs.forEach(visit);
  return files;
};

const checkOnly = process.argv.includes("--check");
const inputs = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

if (!inputs.length) {
  console.error("usage: node scripts/fix-arabic-mojibake.cjs [--check] <file-or-directory...>");
  process.exit(1);
}

const targets = expandTargets(inputs);

/**
 * A handful of files hold corrupted Arabic on purpose — test fixtures for the runtime
 * repair util, and the doc comments in the repair tooling itself. They opt out with a
 * marker comment so the CI guard can run over the whole repo without false failures.
 */
const ALLOW_MARKER = "mojibake-fixture: allow";

let totalRepairs = 0;
let dirtyFiles = 0;
let skipped = 0;

for (const file of targets) {
  const raw = fs.readFileSync(file);
  if (raw.includes(ALLOW_MARKER)) {
    skipped += 1;
    continue;
  }
  const hasBom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
  const source = raw.toString("utf8").replace(/^﻿/, "");
  const { result, repairs } = repairFully(source);
  if (!repairs.length) {
    if (!checkOnly) console.log(`  ${path.basename(file)}: clean`);
    continue;
  }
  dirtyFiles += 1;
  totalRepairs += repairs.length;
  if (checkOnly) {
    console.error(`  ${file}: ${repairs.length} corrupted Arabic run(s)`);
    for (const repair of repairs.slice(0, 5)) {
      console.error(`    line ${repair.line}: ${repair.before.slice(0, 40)} -> ${repair.after.slice(0, 40)}`);
    }
    continue;
  }
  fs.writeFileSync(file, (hasBom ? "﻿" : "") + result, "utf8");
  console.log(`  ${path.basename(file)}: repaired ${repairs.length} run(s)`);
}

if (checkOnly && dirtyFiles) {
  console.error(`\n${totalRepairs} corrupted Arabic run(s) in ${dirtyFiles} file(s). Run: node scripts/fix-arabic-mojibake.cjs <file>`);
  process.exit(1);
}

console.log(`\n${checkOnly ? "checked" : "repaired"} ${totalRepairs} run(s) across ${dirtyFiles} file(s)`);
