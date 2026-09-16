import assert from "node:assert/strict";
import test from "node:test";

import { stripSensitiveUserFields } from "../server/utils/sanitizeUser.js";

test("stripSensitiveUserFields removes every password and MFA column", () => {
  const safe = stripSensitiveUserFields({
    id: 1,
    email: "a@b.c",
    password: "$2b$10$x",
    password_hash: "h",
    hashed_password: "h",
    password_digest: "h",
    mfa_secret_encrypted: "s",
    mfa_recovery_codes_hash: "r",
  });
  assert.deepEqual(safe, { id: 1, email: "a@b.c" });
  assert.equal(stripSensitiveUserFields(null), null);
});
