// Credential security regression suite.
//
// Proves, behaviourally where possible and structurally where the database is
// required, that a DVR password:
//
//   * is never stored as plaintext
//   * never appears in an API response
//   * never appears in a log line
//   * is only ever decrypted server-side, in one named function
//   * fails closed when its envelope is tampered with or foreign

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  decryptSurveillanceSecret,
  describeSurveillanceEncryptionKey,
  encryptSurveillanceSecret,
  isSurveillanceEncryptedEnvelope,
  surveillanceEncryptionKeyConfigured,
  tryDecryptSurveillanceSecret,
} from "../../server/services/surveillance/surveillanceCryptoService.js";
import { redactSurveillance, redactString } from "../../server/services/surveillance/surveillanceRedaction.js";

const KEY = "b7f3c1a95e2d4806af17bc3d9e05128647aa3f9c02bd5e7148936cf20ab4dd51";
const OTHER_KEY = "11aa22bb33cc44dd55ee66ff7788990011223344556677889900aabbccddeeff";
const PASSWORD = "Hunter2!-dvr-2026";

const withKey = (value, fn) => {
  const original = process.env.SURVEILLANCE_ENCRYPTION_KEY;
  if (value === null) delete process.env.SURVEILLANCE_ENCRYPTION_KEY;
  else process.env.SURVEILLANCE_ENCRYPTION_KEY = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.SURVEILLANCE_ENCRYPTION_KEY;
    else process.env.SURVEILLANCE_ENCRYPTION_KEY = original;
  }
};

/* ------------------------------------------------------------------ *
 * Round trip and envelope
 * ------------------------------------------------------------------ */

test("a credential round-trips and its ciphertext contains no plaintext", () => {
  withKey(KEY, () => {
    const envelope = encryptSurveillanceSecret(PASSWORD);
    assert.ok(isSurveillanceEncryptedEnvelope(envelope));
    assert.ok(envelope.startsWith("srv:v1:"));
    assert.ok(!envelope.includes(PASSWORD));
    assert.ok(!envelope.includes("Hunter2"));
    assert.equal(decryptSurveillanceSecret(envelope), PASSWORD);
  });
});

test("encrypting the same password twice produces different ciphertext", () => {
  withKey(KEY, () => {
    // A deterministic ciphertext would let anyone with database access tell
    // which recorders share a password — a real finding in a chain of stores.
    const a = encryptSurveillanceSecret(PASSWORD);
    const b = encryptSurveillanceSecret(PASSWORD);
    assert.notEqual(a, b);
    assert.equal(decryptSurveillanceSecret(a), decryptSurveillanceSecret(b));
  });
});

test("non-ASCII and long passwords survive the round trip", () => {
  withKey(KEY, () => {
    for (const secret of ["كلمة-سر-قوية", "p@ss word/with:colons@and@ats", "x".repeat(200)]) {
      assert.equal(decryptSurveillanceSecret(encryptSurveillanceSecret(secret)), secret);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Fail closed
 * ------------------------------------------------------------------ */

test("a tampered ciphertext fails closed instead of returning garbage", () => {
  withKey(KEY, () => {
    const envelope = encryptSurveillanceSecret(PASSWORD);
    const [prefix, version, iv, tag, payload] = envelope.split(":");
    // Flip one character of the ciphertext. AES-GCM must detect it.
    const flipped = payload[0] === "A" ? `B${payload.slice(1)}` : `A${payload.slice(1)}`;
    const tampered = [prefix, version, iv, tag, flipped].join(":");

    assert.throws(
      () => decryptSurveillanceSecret(tampered),
      (error) => error.code === "SURVEILLANCE_ENVELOPE_TAMPERED",
    );
  });
});

test("a ciphertext from a different key fails closed", () => {
  const envelope = withKey(KEY, () => encryptSurveillanceSecret(PASSWORD));
  withKey(OTHER_KEY, () => {
    assert.throws(
      () => decryptSurveillanceSecret(envelope),
      (error) => error.code === "SURVEILLANCE_ENVELOPE_TAMPERED",
    );
  });
});

test("a plaintext value in the column is refused, not returned", () => {
  withKey(KEY, () => {
    // The exact bug this module exists to prevent: a password written straight
    // into the column. Returning it would send it to a device and hide the bug.
    assert.throws(
      () => decryptSurveillanceSecret("Hunter2!-dvr-2026"),
      (error) => error.code === "SURVEILLANCE_ENVELOPE_INVALID",
    );
  });
});

test("a foreign envelope from another subsystem is refused", () => {
  withKey(KEY, () => {
    for (const foreign of ["tk:v1:aa:bb:cc", "tkb:v1:aa:bb:cc"]) {
      assert.throws(
        () => decryptSurveillanceSecret(foreign),
        (error) => error.code === "SURVEILLANCE_ENVELOPE_INVALID",
        foreign,
      );
    }
  });
});

test("a malformed envelope is refused", () => {
  withKey(KEY, () => {
    // Wrong number of segments, or segments that are not base64 of the right
    // length. All fail closed; the distinction between "not our envelope" and
    // "our envelope, broken" is only for diagnostics.
    for (const bad of ["srv:v1:only-two", "srv:v1:a:b:c:d", "srv:v1:::"]) {
      assert.throws(
        () => decryptSurveillanceSecret(bad),
        (error) =>
          error.code === "SURVEILLANCE_ENVELOPE_MALFORMED" ||
          error.code === "SURVEILLANCE_ENVELOPE_TAMPERED",
        bad,
      );
    }
    // "srv:v1" with no trailing colon is not the prefix at all.
    assert.throws(
      () => decryptSurveillanceSecret("srv:v1"),
      (error) => error.code === "SURVEILLANCE_ENVELOPE_INVALID",
    );
  });
});

test("tryDecrypt never throws and never returns the ciphertext on failure", () => {
  withKey(KEY, () => {
    const result = tryDecryptSurveillanceSecret("srv:v1:aa:bb:cc", { deviceId: 1 });
    assert.equal(result.value, "");
    assert.ok(result.error);
  });
});

/* ------------------------------------------------------------------ *
 * Key isolation — no fallback to other platform secrets
 * ------------------------------------------------------------------ */

test("the key has no fallback to any other platform secret", () => {
  const saved = {
    JWT_SECRET: process.env.JWT_SECRET,
    SECRET_ENCRYPTION_KEY: process.env.SECRET_ENCRYPTION_KEY,
    TIKTOK_ENCRYPTION_KEY: process.env.TIKTOK_ENCRYPTION_KEY,
    TIKTOK_BUSINESS_ENCRYPTION_KEY: process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY,
  };
  // Set every OTHER secret to strong material and leave ours unset. If any
  // fallback existed, encryption would succeed.
  process.env.JWT_SECRET = KEY;
  process.env.SECRET_ENCRYPTION_KEY = KEY;
  process.env.TIKTOK_ENCRYPTION_KEY = KEY;
  process.env.TIKTOK_BUSINESS_ENCRYPTION_KEY = KEY;

  try {
    withKey(null, () => {
      assert.equal(surveillanceEncryptionKeyConfigured(), false);
      assert.equal(describeSurveillanceEncryptionKey().code, "SURVEILLANCE_ENCRYPTION_KEY_MISSING");
      assert.throws(
        () => encryptSurveillanceSecret(PASSWORD),
        (error) => error.code === "SURVEILLANCE_ENCRYPTION_KEY_MISSING",
      );
    });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a weak or placeholder key is refused rather than used", () => {
  for (const weak of ["short", "a".repeat(64), "change-me-please-change-me-please", "placeholder-key-value-1234567890"]) {
    withKey(weak, () => {
      assert.equal(surveillanceEncryptionKeyConfigured(), false, weak);
      assert.throws(() => encryptSurveillanceSecret(PASSWORD), /SURVEILLANCE_ENCRYPTION_KEY/, weak);
    });
  }
});

test("key diagnostics never disclose the key or its length", () => {
  withKey(KEY, () => {
    const described = JSON.stringify(describeSurveillanceEncryptionKey());
    assert.ok(!described.includes(KEY));
    assert.ok(!described.includes(String(KEY.length)));
  });
});

/* ------------------------------------------------------------------ *
 * Logs
 * ------------------------------------------------------------------ */

test("a password is redacted out of a log payload whatever key holds it", () => {
  const payload = {
    device: { id: 4, host: "192.168.1.108" },
    credentials: { username: "erp_surveillance", password: PASSWORD },
    auth: { user: "erp_surveillance", pass: PASSWORD },
    headers: { authorization: `Basic ZXJwOkh1bnRlcjI=`, "x-token": "abc123secret" },
    devicePassword: PASSWORD,
  };
  const redacted = JSON.stringify(redactSurveillance(payload));

  assert.ok(!redacted.includes(PASSWORD), redacted);
  assert.ok(!redacted.includes("Hunter2"), redacted);
  assert.ok(!redacted.includes("ZXJwOkh1bnRlcjI="), redacted);
  assert.ok(!redacted.includes("abc123secret"), redacted);

  // A secret-named KEY redacts its whole value, so `credentials` and `auth`
  // vanish including the username inside them. That is stronger than strictly
  // necessary and it is the right trade: a nested object under a key called
  // "credentials" is not somewhere to go looking for salvageable context.
  assert.ok(!redacted.includes("erp_surveillance"), redacted);

  // Context outside those keys must survive, or the log becomes useless.
  assert.ok(redacted.includes("192.168.1.108"), redacted);
  assert.ok(redacted.includes('"id":4'), redacted);
});

test("credentials embedded in an RTSP or HTTP URL are stripped", () => {
  const cases = [
    "rtsp://erp_surveillance:Hunter2@192.0.2.10:554/cam/realmonitor?channel=1",
    "http://admin:P%40ssw0rd@192.0.2.10/cgi-bin/magicBox.cgi",
    "connecting to rtsp://user:pass@host/stream failed",
  ];
  for (const value of cases) {
    const redacted = redactString(value);
    assert.ok(!redacted.includes("Hunter2"), value);
    assert.ok(!redacted.includes("P%40ssw0rd"), value);
    assert.ok(!redacted.includes(":pass@"), value);
    assert.ok(redacted.includes("[redacted]"), value);
    // The host is still readable, which is what makes the log worth keeping.
    assert.ok(/192\.0\.2\.10|host/.test(redacted), value);
  }
});

test("an axios-shaped error does not leak its config, auth or URL", () => {
  // The realistic leak: console.error("probe failed", error) where the error
  // still carries the whole request.
  const error = new Error(`Request failed for rtsp://admin:${PASSWORD}@192.0.2.10:554`);
  error.config = {
    url: `http://192.168.1.108/cgi-bin/x.cgi`,
    auth: { username: "admin", password: PASSWORD },
    headers: { Authorization: `Digest username="admin", response="9a8b7c6d5e4f3a2b"` },
  };
  error.response = { data: { password: PASSWORD } };
  error.stack = `Error: rtsp://admin:${PASSWORD}@host\n    at probe (/app/x.js:1:1)`;

  const redacted = JSON.stringify(redactSurveillance(error));
  assert.ok(!redacted.includes(PASSWORD), redacted);
  // config/response/stack are dropped wholesale rather than walked.
  assert.ok(!redacted.includes("9a8b7c6d5e4f3a2b"), redacted);
  assert.ok(!redacted.includes("/app/x.js"), redacted);
});

test("an encrypted envelope is not logged in full", () => {
  withKey(KEY, () => {
    const envelope = encryptSurveillanceSecret(PASSWORD);
    const redacted = redactString(`stored ${envelope}`);
    assert.ok(redacted.includes("srv:v1:[redacted]"), redacted);
    assert.ok(!redacted.includes(envelope), redacted);
  });
});

/* ------------------------------------------------------------------ *
 * Storage and exposure — structural, because these need a database
 * ------------------------------------------------------------------ */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the schema has no plaintext password column", () => {
  const schema = read("../../server/services/surveillance/surveillanceSchema.js");
  const migration = read("../../server/database/migrations/2026-08-17-add-surveillance-center.sql");

  for (const [name, source] of [["schema", schema], ["migration", migration]]) {
    assert.ok(source.includes("password_encrypted TEXT"), name);
    // A bare `password` column must not exist anywhere in the surveillance DDL.
    assert.doesNotMatch(source, /^\s*password\s+(VARCHAR|TEXT)/mi, name);
  }
});

test("decryption happens in exactly one named function, in one file", () => {
  const repo = read("../../server/services/surveillance/repositories/surveillanceCredentialRepository.js");
  assert.match(repo, /export const loadCredentialsForConnection/);
  assert.match(repo, /decryptSurveillanceSecret\(row\.password_encrypted\)/);

  // No other surveillance module may import the decrypt function.
  const others = [
    "../../server/services/surveillance/repositories/surveillanceDeviceRepository.js",
    "../../server/services/surveillance/repositories/surveillanceAccessRepository.js",
    "../../server/services/surveillance/surveillanceAuditService.js",
    "../../server/middleware/surveillanceGuards.js",
  ];
  for (const path of others) {
    assert.doesNotMatch(read(path), /decryptSurveillanceSecret/, path);
  }
});

test("no read path returns the ciphertext or a password field", () => {
  const repo = read("../../server/services/surveillance/repositories/surveillanceCredentialRepository.js");

  // describeCredentials must expose only a boolean.
  const describeStart = repo.indexOf("export const describeCredentials");
  const describeEnd = repo.indexOf("export const saveCredentials");
  const describeSource = repo.slice(describeStart, describeEnd);
  assert.match(describeSource, /password_configured/);
  assert.doesNotMatch(describeSource, /password_encrypted,/);
  assert.doesNotMatch(describeSource, /password:/);

  // saveCredentials returns nothing at all.
  const saveStart = repo.indexOf("export const saveCredentials");
  const saveEnd = repo.indexOf("export const loadCredentialsForConnection");
  assert.doesNotMatch(repo.slice(saveStart, saveEnd), /RETURNING/);
});

test("the device projection sent to a browser carries no address or credential", () => {
  const repo = read("../../server/services/surveillance/repositories/surveillanceDeviceRepository.js");
  const start = repo.indexOf("export const toPublicDevice");
  const end = repo.indexOf("/* ---", start);
  const projection = repo.slice(start, end);

  for (const field of ["host", "port", "password", "serial_hash"]) {
    assert.doesNotMatch(projection, new RegExp(`^\\s*${field}:`, "m"), field);
  }
});
