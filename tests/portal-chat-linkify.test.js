import assert from "node:assert/strict";
import test from "node:test";

import { portalChatTextParts } from "../src/shared/chat/portalChatUtils.js";

test("portal chat splits links from surrounding text", () => {
  assert.deepEqual(portalChatTextParts("افتح https://erp.m1store-egy.com/employee-portal/abc الآن"), [
    { type: "text", text: "افتح " },
    { type: "link", text: "https://erp.m1store-egy.com/employee-portal/abc", href: "https://erp.m1store-egy.com/employee-portal/abc" },
    { type: "text", text: " الآن" },
  ]);
});

test("portal chat normalizes www links and excludes sentence punctuation", () => {
  assert.deepEqual(portalChatTextParts("www.m1store-egy.com،"), [
    { type: "link", text: "www.m1store-egy.com", href: "https://www.m1store-egy.com" },
    { type: "text", text: "،" },
  ]);
});
