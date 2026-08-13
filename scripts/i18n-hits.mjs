/**
 * Per-hit inspector: `node scripts/i18n-hits.mjs <path fragment> [...]`
 *
 * Prints every hit the two broken buckets hold for the matching files, with the
 * line number and the literal, so a migration can be decided hit by hit rather
 * than file by file.
 */
import { classify } from "./i18n-classify.mjs";
import { scanEnglish } from "./i18n-english-scan.mjs";

const needles = process.argv.slice(2);
if (!needles.length) {
  console.error("usage: node scripts/i18n-hits.mjs <path fragment> [...]");
  process.exit(1);
}
const matches = (file) => needles.some((needle) => file.includes(needle));

const ar = classify();
const en = scanEnglish();

const byFile = new Map();
const push = (file, side, hits) => {
  if (!matches(file)) return;
  if (!byFile.has(file)) byFile.set(file, []);
  for (const hit of hits) byFile.get(file).push({ ...hit, side });
};

for (const row of ar.broken) push(row.file, "AR", row.hits.filter((hit) => hit.script === "ar"));
for (const row of en.brokenEnglish) push(row.file, "EN", row.hits);

for (const [file, hits] of byFile) {
  console.log(`\n=== ${file}  (${hits.length}) ===`);
  for (const hit of hits.sort((a, b) => a.line - b.line)) {
    console.log(`  ${hit.side} ${String(hit.line).padStart(5)}  [${hit.type}${hit.attr ? ` ${hit.attr}` : ""}]  ${hit.value}`);
  }
}
