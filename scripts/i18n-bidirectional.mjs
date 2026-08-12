/**
 * Authoritative BIDIRECTIONAL localization metric.
 *
 * A screen is broken in two independent ways:
 *   AR->EN leak: hardcoded Arabic renders inside English mode
 *   EN->AR leak: hardcoded English renders inside Arabic mode
 *
 * Counting only Arabic literals — which every earlier pass did — hides half the
 * problem. This report sums both sides and buckets everything else with a reason,
 * so "remaining" is never an unexplained number.
 */
import { classify } from "./i18n-classify.mjs";
import { scanEnglish } from "./i18n-english-scan.mjs";

const sum = (rows, key = "total") => rows.reduce((total, row) => total + (row[key] ?? 0), 0);

const arabic = classify();
const english = scanEnglish();

// The Arabic classifier's `broken` bucket counts BOTH scripts in those files;
// only its Arabic half is an AR->EN leak. The English scanner owns the other side.
const arLeak = sum(arabic.broken, "arabic");
const enLeak = sum(english.brokenEnglish);

const rows = [
  ["1. broken AR->EN leak", arLeak, `${arabic.broken.length} files`],
  ["2. broken EN->AR leak", enLeak, `${english.brokenEnglish.length} files`],
  ["3. working bilingual", sum(arabic.bilingual), `${arabic.bilingual.length} files - renders correctly in both`],
  ["4. business/data", sum(arabic.data), `${arabic.data.length} files - catalogue/persisted values`],
  ["5. customer/AI content", sum(english.aiContent), `${english.aiContent.length} files - AI Inbox/Studio surfaces`],
  ["6. technical/brand", sum(english.identifiers), `${english.identifiers.length} files - lookup identifiers`],
  ["7. print/export", sum(arabic.excluded) + sum(english.print), `${arabic.excluded.length + english.print.length} files`],
  ["8. prototype/dead", sum(arabic.prototype) + sum(english.prototype), `${arabic.prototype.length + english.prototype.length} files`],
  ["9. debug/log", sum(english.debug), "excluded by the scanner"],
];

console.log("BIDIRECTIONAL LOCALIZATION REPORT\n");
for (const [label, count, note] of rows) {
  console.log(`${label.padEnd(26)} ${String(count).padStart(6)}   ${note}`);
}
console.log(`\nTOTAL GENUINE DEFECTS: ${arLeak + enLeak}  (AR->EN ${arLeak} + EN->AR ${enLeak})`);

console.log("\n--- top AR->EN leak files ---");
for (const row of arabic.broken.filter((r) => r.arabic > 0).sort((a, b) => b.arabic - a.arabic).slice(0, 12)) {
  console.log(`  ${String(row.arabic).padStart(4)}  ${row.file}`);
}
console.log("\n--- top EN->AR leak files ---");
for (const row of english.brokenEnglish.sort((a, b) => b.total - a.total).slice(0, 12)) {
  console.log(`  ${String(row.total).padStart(4)}  ${row.file}`);
}
