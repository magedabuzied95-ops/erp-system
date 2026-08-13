/**
 * Full per-file dump of the two broken buckets, for triage.
 * Not a gate; a reporting aid for the localization producer.
 */
import { classify } from "./i18n-classify.mjs";
import { scanEnglish } from "./i18n-english-scan.mjs";

const ar = classify();
const en = scanEnglish();

console.log("=== AR->EN broken (arabic hits only) ===");
for (const row of ar.broken.filter((r) => r.arabic > 0).sort((a, b) => b.arabic - a.arabic)) {
  console.log(`${String(row.arabic).padStart(4)}  ${row.file}`);
}
console.log(`TOTAL AR->EN ${ar.broken.reduce((t, r) => t + r.arabic, 0)}`);

console.log("\n=== EN->AR broken ===");
for (const row of en.brokenEnglish.sort((a, b) => b.total - a.total)) {
  console.log(`${String(row.total).padStart(4)}  ${row.file}`);
}
console.log(`TOTAL EN->AR ${en.brokenEnglish.reduce((t, r) => t + r.total, 0)}`);
