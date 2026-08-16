// mojibake-fixture: allow — this file stores corrupted Arabic on purpose.
import test from "node:test";
import assert from "node:assert/strict";

import { repairCorruptedArabicValue } from "../server/utils/arabicTextRepair.js";

test("valid Arabic text stays unchanged", () => {
  const value = "عميل قريب جدًا من الشراء";
  assert.equal(repairCorruptedArabicValue(value), value);
});

test("common Arabic mojibake decodes to the intended text", () => {
  const corrupted = "ط¹ظ…ظٹظ„ ظ‚ط±ظٹط¨ ط¬ط¯ظ‹ط§ مظ† ط§ظ„ط´ط±ط§ط،";
  const expected = "عميل قريب جدًا من الشراء";
  assert.equal(repairCorruptedArabicValue(corrupted), expected);
});

test("repair is idempotent", () => {
  const corrupted = "ط¹ظ…ظٹظ„ ظ‚ط±ظٹط¨ ط¬ط¯ظ‹ط§ مظ† ط§ظ„ط´ط±ط§ط،";
  const repaired = repairCorruptedArabicValue(corrupted);
  assert.equal(repairCorruptedArabicValue(repaired), repaired);
});
