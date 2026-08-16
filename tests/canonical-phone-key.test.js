import test from "node:test";
import assert from "node:assert/strict";
import { canonicalPhoneKey, canonicalPhoneSql } from "../server/utils/phoneSearch.js";

test("one Egyptian mobile has one key however it was typed", () => {
  const expected = "1068005338";

  for (const spelling of [
    "+201068005338",
    "00201068005338",
    "201068005338",
    "01068005338",
    "1068005338",
    "+20 106 800 5338",
    "0106-800-5338",
    "٠١٠٦٨٠٠٥٣٣٨",
  ]) {
    assert.equal(canonicalPhoneKey(spelling), expected, spelling);
  }
});

test("numbers that are not Egyptian mobiles keep their digits", () => {
  assert.equal(canonicalPhoneKey("+966501234567"), "966501234567");
  // Landlines keep their leading zero: only the 01X mobile shape is unwrapped,
  // so nothing outside that shape can be folded onto another customer's key.
  assert.equal(canonicalPhoneKey("+20233334444"), "20233334444");
  assert.equal(canonicalPhoneKey("02012345678"), "02012345678");
  assert.equal(canonicalPhoneKey(""), "");
  assert.equal(canonicalPhoneKey(null), "");
});

test("different customers do not collapse onto one key", () => {
  assert.notEqual(canonicalPhoneKey("01068005338"), canonicalPhoneKey("01068005339"));
});

test("the SQL twin mirrors the JS rules", () => {
  const sql = canonicalPhoneSql("phone");

  assert.match(sql, /\^201\[0-9\]\{9\}\$/);
  assert.match(sql, /\^01\[0-9\]\{9\}\$/);
  assert.match(sql, /\^00/);
  // Arabic-Indic digits are folded before the shape is tested.
  assert.match(sql, /translate\(/);
});
