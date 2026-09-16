import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../server/services/metaIntegrationService.js", import.meta.url), "utf8");

// minutesFromNow() is a UTC ISO string. `::timestamp` drops its "Z", and the Cairo
// DB session then reads the wall-clock as local time: the 15-minute state was
// born ~3 hours expired, so every "Reconnect Meta" ended in invalid_state.
test("the OAuth state expiry keeps its UTC offset", () => {
  assert.match(source, /INSERT INTO meta_oauth_states \(tenant_id, user_id, state_token, status, expires_at\)\s+VALUES \(\$1,\$2,\$3,'started',\$4::timestamptz\)/);
});

test("an invalid OAuth state is logged, not only shown in the popup", () => {
  assert.match(source, /meta_oauth_callback_invalid_state/);
  assert.match(source, /meta_oauth_callback_failed/);
});
