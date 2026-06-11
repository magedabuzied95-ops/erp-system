import { repairArabicMojibakeText } from "../utils/textEncoding.js";

const cases = [
  ["ظ…ظ‚ط§ط³ط§طھ ظ†ط§ظ‚طµط©", "مقاسات ناقصة"],
  ["ط¨ط¹ط¶ ط§ظ„ظ…ظ‚ط§ط³ط§طھ ط؛ظٹط± ظ…ظƒطھظ…ظ„ط©", "بعض المقاسات غير مكتملة"],
  ["ط·ظ„ط¨ ظƒط±طھظˆظ†ط© ظˆط§ط­ط¯ط©", "طلب كرتونة واحدة"],
];

let failed = false;

for (const [input, expected] of cases) {
  const actual = repairArabicMojibakeText(input);
  const ok = actual === expected;
  console.log(JSON.stringify({ input, actual, expected, ok }, null, 2));
  if (!ok) failed = true;
}

if (failed) {
  process.exitCode = 1;
}
