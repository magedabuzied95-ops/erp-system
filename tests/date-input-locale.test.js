import assert from "node:assert/strict";
import test from "node:test";

import { DATE_INPUT_SELECTOR, DAY_FIRST_INPUT_LOCALE } from "../src/shared/utils/dateInputLocale.js";
import { getLocale } from "../src/shared/lib/locale.js";

test("native date controls use a day-first locale", () => {
  assert.equal(DAY_FIRST_INPUT_LOCALE, "en-GB");
  assert.match(DATE_INPUT_SELECTOR, /input\[type="date"\]/);
  assert.match(DATE_INPUT_SELECTOR, /input\[type="datetime-local"\]/);
});

test("formatted English dates use day-first British ordering", () => {
  assert.equal(getLocale("en"), "en-GB");
  assert.equal(getLocale("ar"), "ar-EG");
});
