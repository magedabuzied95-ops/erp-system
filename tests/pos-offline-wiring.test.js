import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pos = readFileSync(new URL("../src/modules/pos/pages/POSPro.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the POS wires the offline queue hardening into the till", () => {
  assert.match(pos, /void applyOfflineSaleToCachedCatalog\(offlineCheckoutSnapshot\.cartItems\);/);
  assert.match(pos, /if \(result\?\.status === "busy"\) \{/);
  assert.match(pos, /setOfflineLoginRequired\(Boolean\(result\.loginRequired\)\)/);
  assert.match(pos, /loginRequired=\{offlineLoginRequired\}/);
  assert.match(pos, /if \(posBackendOnline\) void warmOfflinePosScreens\(\);/);
  assert.equal((pos.match(/error\?\.code === "OFFLINE_DISCARD_FORBIDDEN"/g) || []).length, 2);
});
