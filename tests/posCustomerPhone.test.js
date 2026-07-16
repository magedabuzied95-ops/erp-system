import assert from "node:assert/strict";
import test from "node:test";

import { getCompleteEgyptianMobilePhone } from "../src/modules/pos/lib/phoneSearch.js";

test("complete POS customer phone accepts supported Egyptian mobile formats", () => {
  assert.equal(getCompleteEgyptianMobilePhone("01024960595"), "+201024960595");
  assert.equal(getCompleteEgyptianMobilePhone("1024960595"), "+201024960595");
  assert.equal(getCompleteEgyptianMobilePhone("+20 102 496 0595"), "+201024960595");
  assert.equal(getCompleteEgyptianMobilePhone("٠١٠٢٤٩٦٠٥٩٥"), "+201024960595");
});

test("incomplete or non-phone POS customer search does not trigger customer creation", () => {
  assert.equal(getCompleteEgyptianMobilePhone("0102496059"), "");
  assert.equal(getCompleteEgyptianMobilePhone("010249605951"), "");
  assert.equal(getCompleteEgyptianMobilePhone("Ahmed 01024960595"), "");
});
