// TikTok token encryption: key isolation and fail-closed behaviour.
//
// The property under test is that TikTok tokens are bound to TIKTOK_ENCRYPTION_KEY
// and to nothing else. Production has SECRET_ENCRYPTION_KEY unset and every
// existing Meta ciphertext bound to JWT_SECRET, so a fallback here would either
// silently ride on JWT_SECRET or push the operator toward setting
// SECRET_ENCRYPTION_KEY — which would re-key Meta and break live Facebook and
// Instagram tokens. These tests exist to keep that fallback from ever coming back.
//
// The module reads process.env at call time, so each test sets the environment it
// needs and restores it afterwards; there is no cached key to invalidate.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const KEY_A = "tiktok-key-alpha-0123456789abcdef";
const KEY_B = "tiktok-key-bravo-fedcba9876543210";

process.env.TIKTOK_ENCRYPTION_KEY = KEY_A;

const {
  TIKTOK_ENCRYPTION_KEY_ENV,
  TikTokCryptoError,
  decryptTikTokSecret,
  describeTikTokEncryptionKey,
  encryptTikTokSecret,
  isTikTokEncryptedEnvelope,
  tiktokEncryptionKeyConfigured,
  tryDecryptTikTokSecret,
} = await import("../../server/services/tiktokCryptoService.js");

const { validateTikTokConfig, describeTikTokConfig } = await import("../../server/services/tiktokConfigService.js");

const cryptoSource = readFileSync(new URL("../../server/services/tiktokCryptoService.js", import.meta.url), "utf8");

// Runs `fn` with a temporary environment, restoring whatever was there before —
// including variables that were previously absent.
const withEnv = (patch, fn) => {
  const previous = {};
  for (const [key, value] of Object.entries(patch)) {
    previous[key] = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// ---------------------------------------------------------------------------
// 1. TikTok uses TIKTOK_ENCRYPTION_KEY
// ---------------------------------------------------------------------------

test("TikTok encryption reads its key from TIKTOK_ENCRYPTION_KEY", () => {
  assert.equal(TIKTOK_ENCRYPTION_KEY_ENV, "TIKTOK_ENCRYPTION_KEY");
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => {
    assert.equal(tiktokEncryptionKeyConfigured(), true);
    assert.deepEqual(describeTikTokEncryptionKey(), { configured: true, reason: "" });
  });
});

test("the ciphertext is actually bound to TIKTOK_ENCRYPTION_KEY", () => {
  const envelope = withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => encryptTikTokSecret("act.bound-token"));
  // Same key -> readable.
  assert.equal(withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => decryptTikTokSecret(envelope)), "act.bound-token");
  // Different key -> unreadable, not silently wrong.
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_B }, () => {
    assert.throws(() => decryptTikTokSecret(envelope));
  });
});

// ---------------------------------------------------------------------------
// 2-3. No coupling to JWT_SECRET or SECRET_ENCRYPTION_KEY
// ---------------------------------------------------------------------------

test("changing JWT_SECRET does not affect TikTok decryption", () => {
  const envelope = withEnv(
    { TIKTOK_ENCRYPTION_KEY: KEY_A, JWT_SECRET: "jwt-before-rotation" },
    () => encryptTikTokSecret("act.survives-jwt-rotation")
  );
  const readBack = withEnv(
    { TIKTOK_ENCRYPTION_KEY: KEY_A, JWT_SECRET: "jwt-completely-different-after-rotation" },
    () => decryptTikTokSecret(envelope)
  );
  assert.equal(readBack, "act.survives-jwt-rotation", "rotating JWT_SECRET must not orphan TikTok tokens");
});

test("introducing SECRET_ENCRYPTION_KEY does not change the TikTok key", () => {
  // This is the exact production scenario: SECRET_ENCRYPTION_KEY is absent today
  // and may be introduced later for the shared Meta rotation project.
  const envelope = withEnv(
    { TIKTOK_ENCRYPTION_KEY: KEY_A, SECRET_ENCRYPTION_KEY: undefined },
    () => encryptTikTokSecret("act.unaffected-by-shared-key")
  );
  const readBack = withEnv(
    { TIKTOK_ENCRYPTION_KEY: KEY_A, SECRET_ENCRYPTION_KEY: "a-newly-introduced-shared-key" },
    () => decryptTikTokSecret(envelope)
  );
  assert.equal(readBack, "act.unaffected-by-shared-key");
});

test("removing SECRET_ENCRYPTION_KEY and JWT_SECRET entirely leaves TikTok working", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A, SECRET_ENCRYPTION_KEY: undefined, JWT_SECRET: undefined }, () => {
    const envelope = encryptTikTokSecret("act.standalone");
    assert.equal(decryptTikTokSecret(envelope), "act.standalone");
  });
});

// ---------------------------------------------------------------------------
// 4-6. Fail closed — no fallback of any kind
// ---------------------------------------------------------------------------

test("a missing TIKTOK_ENCRYPTION_KEY fails closed instead of falling back to JWT_SECRET", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: undefined, JWT_SECRET: "a-perfectly-usable-jwt-secret-value" }, () => {
    assert.equal(tiktokEncryptionKeyConfigured(), false);
    assert.throws(
      () => encryptTikTokSecret("act.should-never-be-encrypted"),
      (error) => error instanceof TikTokCryptoError && error.code === "TIKTOK_ENCRYPTION_KEY_MISSING"
    );
  });
});

test("a missing TIKTOK_ENCRYPTION_KEY fails closed instead of falling back to SECRET_ENCRYPTION_KEY", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: undefined, SECRET_ENCRYPTION_KEY: "a-perfectly-usable-shared-secret" }, () => {
    assert.equal(tiktokEncryptionKeyConfigured(), false);
    assert.throws(
      () => encryptTikTokSecret("act.should-never-be-encrypted"),
      (error) => error.code === "TIKTOK_ENCRYPTION_KEY_MISSING"
    );
  });
});

test("a weak key is rejected rather than stretched into a valid-looking envelope", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: "short" }, () => {
    assert.equal(tiktokEncryptionKeyConfigured(), false);
    assert.equal(describeTikTokEncryptionKey().reason, "too_short");
    assert.throws(() => encryptTikTokSecret("act.x"), (error) => error.code === "TIKTOK_ENCRYPTION_KEY_WEAK");
  });
});

test("TIKTOK_ENABLED=true without an encryption key is a reported configuration failure", () => {
  withEnv(
    {
      TIKTOK_ENABLED: "true",
      TIKTOK_CLIENT_KEY: "ck",
      TIKTOK_CLIENT_SECRET: "cs",
      TIKTOK_REDIRECT_URI: "https://api.m1store-egy.com/api/tiktok/oauth/callback",
      TIKTOK_ENCRYPTION_KEY: undefined,
      JWT_SECRET: "present-but-must-not-be-used",
      SECRET_ENCRYPTION_KEY: "present-but-must-not-be-used",
    },
    () => {
      const { valid, problems } = validateTikTokConfig();
      assert.equal(valid, false, "an enabled TikTok with no key must not validate");
      const message = problems.join(" | ");
      assert.match(message, /TIKTOK_ENCRYPTION_KEY is required/);
      assert.match(message, /no fallback/i);
      assert.equal(describeTikTokConfig().encryption_key_present, false);
    }
  );
});

test("the source contains no fallback to any other secret", () => {
  // A grep-level guard: the key selection is one line and must stay that way.
  const keyLine = cryptoSource.split("\n").find((line) => line.includes("const rawKeyMaterial"));
  assert.ok(keyLine, "rawKeyMaterial not found");
  assert.ok(!/JWT_SECRET/.test(keyLine), "JWT_SECRET fallback reintroduced in key selection");
  assert.ok(!/SECRET_ENCRYPTION_KEY/.test(keyLine), "SECRET_ENCRYPTION_KEY fallback reintroduced in key selection");
  assert.ok(!/\|\|/.test(keyLine.replace(/\?\?/g, "")), "a fallback operator appeared in key selection");
});

// ---------------------------------------------------------------------------
// 7-9. Envelope behaviour
// ---------------------------------------------------------------------------

test("an encrypted token never contains its plaintext", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => {
    const secret = "act.super-secret-tiktok-access-token";
    const envelope = encryptTikTokSecret(secret);
    assert.ok(isTikTokEncryptedEnvelope(envelope));
    assert.ok(!envelope.includes(secret));
    assert.ok(!envelope.includes("super-secret"));
  });
});

test("round-trip works and repeated encryption produces distinct ciphertext", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => {
    const a = encryptTikTokSecret("act.round-trip");
    const b = encryptTikTokSecret("act.round-trip");
    assert.notEqual(a, b, "a random IV must make two encryptions differ");
    assert.equal(decryptTikTokSecret(a), "act.round-trip");
    assert.equal(decryptTikTokSecret(b), "act.round-trip");
    assert.equal(encryptTikTokSecret(""), "");
    assert.equal(decryptTikTokSecret(""), "");
  });
});

test("malformed and tampered ciphertext fail safely", () => {
  withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => {
    // Plaintext must never be passed through as if it were decrypted.
    assert.throws(() => decryptTikTokSecret("act.raw-plaintext"), (e) => e.code === "TIKTOK_ENVELOPE_INVALID");
    assert.throws(() => decryptTikTokSecret("tk:v1:onlytwo"), (e) => e.code === "TIKTOK_ENVELOPE_MALFORMED");

    const envelope = encryptTikTokSecret("act.tamper-target");
    const parts = envelope.split(":");
    parts[3] = crypto.randomBytes(16).toString("base64"); // corrupt the auth tag
    assert.throws(() => decryptTikTokSecret(parts.join(":")));
  });
});

// ---------------------------------------------------------------------------
// 10. Nothing secret reaches logs or error messages
// ---------------------------------------------------------------------------

test("a decrypt failure logs identity only, never the key, ciphertext, or plaintext", () => {
  const captured = [];
  const original = console.error;
  console.error = (...args) => captured.push(args);
  try {
    withEnv({ TIKTOK_ENCRYPTION_KEY: KEY_A }, () => {
      const result = tryDecryptTikTokSecret("act.not-an-envelope", { tenant_id: 7, field: "access_token" });
      assert.equal(result.value, "");
      assert.ok(result.error);
    });
  } finally {
    console.error = original;
  }
  const dump = JSON.stringify(captured);
  assert.ok(dump.includes("token_decrypt_failed"));
  assert.ok(dump.includes("access_token"), "the field name is useful context and should be logged");
  assert.ok(!dump.includes(KEY_A), "the encryption key leaked into a log line");
  assert.ok(!dump.includes("act.not-an-envelope"), "the ciphertext/plaintext leaked into a log line");
});

test("configuration errors name the variable but never quote a secret value", () => {
  withEnv(
    { TIKTOK_ENABLED: "true", TIKTOK_CLIENT_KEY: "ck-secret-value", TIKTOK_CLIENT_SECRET: "cs-secret-value", TIKTOK_ENCRYPTION_KEY: undefined },
    () => {
      const dump = JSON.stringify(validateTikTokConfig().problems) + JSON.stringify(describeTikTokConfig());
      assert.ok(!dump.includes("cs-secret-value"), "the client secret leaked into config output");
      assert.ok(dump.includes("TIKTOK_ENCRYPTION_KEY"), "the missing variable should be named");
    }
  );
});

// ---------------------------------------------------------------------------
// Meta encryption must be untouched
// ---------------------------------------------------------------------------

test("META ENCRYPTION BEHAVIOR: UNCHANGED — Meta still selects its key the way it always did", () => {
  // Static verification only: reading the source proves the selection expression
  // is intact without importing the 25k-line Meta module or touching a token.
  for (const [file, marker] of [
    ["../../server/services/metaIntegrationService.js", "secretKey"],
    ["../../server/services/metaConversionsApiService.js", "createHash"],
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const line = source
      .split("\n")
      .find((l) => l.includes("SECRET_ENCRYPTION_KEY") && l.includes("JWT_SECRET"));
    assert.ok(line, `${file}: key-selection line not found (${marker})`);
    assert.match(line, /SECRET_ENCRYPTION_KEY \|\| process\.env\.JWT_SECRET/,
      `${file}: Meta key precedence was altered`);
    assert.ok(!line.includes("TIKTOK"), `${file}: TikTok leaked into Meta key selection`);
  }

  const settings = readFileSync(new URL("../../server/services/settingsService.js", import.meta.url), "utf8");
  assert.match(settings, /process\.env\.SECRET_ENCRYPTION_KEY \|\| process\.env\.JWT_SECRET/);
  assert.ok(!settings.includes("TIKTOK_ENCRYPTION_KEY"), "settingsService must not reference the TikTok key");
});

test("no Meta or settings module reads the TikTok key, and TikTok reads no Meta key", () => {
  // Scoped to import statements. The TikTok module's header explains the Meta
  // coupling it deliberately avoids, and that prose must not read as a dependency.
  const importsOf = (source) => (source.match(/^\s*import[\s\S]*?from\s+"[^"]+";$/gm) || []).join("\n");

  for (const file of [
    "../../server/services/metaIntegrationService.js",
    "../../server/services/metaConversionsApiService.js",
    "../../server/services/settingsService.js",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(!importsOf(source).includes("tiktok"), `${file} must not import any TikTok module`);
    assert.ok(!source.includes("process.env.TIKTOK_ENCRYPTION_KEY"), `${file} must not read the TikTok key`);
  }

  const tiktokImports = importsOf(cryptoSource);
  assert.ok(tiktokImports.length > 0, "no imports found — the scan would pass vacuously");
  assert.ok(!/meta|settingsService/i.test(tiktokImports), "TikTok crypto must not import Meta or settings");
});
