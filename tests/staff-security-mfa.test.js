import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import db from "../server/database/db.js";
import { clearSettingsCache } from "../server/services/settingsService.js";
import {
  changeExpiredPassword,
  confirmLoginMfaEnrollment,
  login,
  startLoginMfaEnrollment,
  verifyLoginMfa,
} from "../server/controllers/authController.js";
import { protect } from "../server/middleware/authMiddleware.js";
import { requireAmazonAccess } from "../server/modules/security/amazonAccess.js";
import {
  PASSWORD_POLICY_EPOCH,
  assessPasswordStatus,
  passwordExpiresAt,
  validateStaffPassword,
} from "../server/modules/security/passwordPolicy.js";
import { base32Encode, currentTotpStep, totpCodeAt, verifyTotp } from "../server/modules/security/totp.js";
import { openMfaSecret, sealMfaSecret } from "../server/modules/security/mfaSecretBox.js";
import { mfaFailureCounter } from "../server/modules/security/staffAuthSecurity.js";
import { staffLoginFailuresByEmail } from "../server/utils/staffLoginThrottle.js";

process.env.JWT_SECRET ||= "test-secret-for-staff-security-suite-0123456789";
const SECRET = process.env.JWT_SECRET;

// ------------------------------------------------------------------ pure pieces

test("password policy: 12+ chars with upper, lower, digit and special", () => {
  assert.equal(validateStaffPassword("Str0ng-Passw0rd!").valid, true);
  assert.deepEqual(validateStaffPassword("Secret123!").errors, ["too_short"]);
  assert.ok(validateStaffPassword("alllowercase-123").errors.includes("missing_upper"));
  assert.ok(validateStaffPassword("ALLUPPERCASE-123").errors.includes("missing_lower"));
  assert.ok(validateStaffPassword("NoDigitsHere-!!").errors.includes("missing_digit"));
  assert.ok(validateStaffPassword("NoSpecials12345").errors.includes("missing_special"));
  assert.ok(validateStaffPassword(`Aa1!${"x".repeat(80)}`).errors.includes("too_long"));
  assert.ok(validateStaffPassword("Maged-Store-2026!", { email: "maged@x.com" }).errors.includes("contains_identity"));
});

test("password expiry: 365 days from last change, legacy accounts count from the policy start", () => {
  const changed = new Date("2026-01-01T00:00:00Z");
  assert.equal(passwordExpiresAt(changed, 365).toISOString(), "2027-01-01T00:00:00.000Z");
  assert.equal(passwordExpiresAt(null, 365).getTime(), PASSWORD_POLICY_EPOCH.getTime() + 365 * 86400000);
  const old = assessPasswordStatus({ user: { password_changed_at: "2024-01-01T00:00:00Z" }, plainPassword: "Str0ng-Passw0rd!", maxAgeDays: 365 });
  assert.equal(old.expired, true);
  assert.deepEqual(old.reasons, ["expired"]);
  const weak = assessPasswordStatus({ user: { password_changed_at: new Date() }, plainPassword: "short", maxAgeDays: 365 });
  assert.deepEqual(weak.reasons, ["weak"]);
});

test("TOTP matches the RFC 6238 SHA-1 test vectors", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(totpCodeAt(secret, Math.floor(59 / 30)), "287082");
  assert.equal(totpCodeAt(secret, Math.floor(1111111109 / 30)), "081804");
  assert.equal(totpCodeAt(secret, Math.floor(2000000000 / 30)), "279037");
  const now = 1111111109 * 1000;
  const step = verifyTotp(secret, "081804", { nowMs: now });
  assert.equal(step, Math.floor(1111111109 / 30));
  assert.equal(verifyTotp(secret, "081804", { nowMs: now, lastUsedStep: step }), null, "a used code must not be accepted again");
  assert.equal(verifyTotp(secret, "000000", { nowMs: now }), null);
});

test("MFA secrets are sealed with AES-GCM and tampering is detected", () => {
  const sealed = sealMfaSecret("JBSWY3DPEHPK3PXP");
  assert.ok(!sealed.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(openMfaSecret(sealed), "JBSWY3DPEHPK3PXP");
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
  assert.throws(() => openMfaSecret(tampered));
});

// ------------------------------------------------------------------ in-memory database

const normalize = (sql) => String(sql || "").replace(/\s+/g, " ").trim();

const installFakeDb = ({ users, settings = {} }) => {
  const original = db.query.bind(db);
  const audit = [];
  db.query = async (sql, params = []) => {
    const text = normalize(sql);
    const byId = (id) => users.find((user) => Number(user.id) === Number(id));

    if (text.includes("information_schema.columns") && text.includes("table_name = 'users'")) {
      return { rows: ["tenant_id", "name", "email", "password", "is_active", "role_id", "last_login_at"].map((column_name) => ({ column_name })) };
    }
    if (text.startsWith("SELECT value FROM system_settings")) {
      return { rows: Object.hasOwn(settings, params[0]) ? [{ value: settings[params[0]] }] : [] };
    }
    if (text.startsWith("INSERT INTO security_audit_events")) {
      audit.push({ event_type: params[3], outcome: params[4], user_id: params[1], details: params[7] });
      return { rows: [], rowCount: 1 };
    }
    if (text.includes("FROM users u") && text.includes("LOWER(u.email) = LOWER($1)")) {
      const email = String(params[0]).toLowerCase();
      return { rows: users.filter((user) => user.email.toLowerCase() === email).map((user) => ({ ...user, role_name: user.role })) };
    }
    if (text.includes("u.mfa_recovery_codes_hash") && text.includes("WHERE u.id = $1")) {
      const user = byId(params[0]);
      return { rows: user ? [{ ...user, role_name: user.role }] : [] };
    }
    if (text.includes("FROM users u") && text.includes("WHERE u.id = $1")) {
      const user = byId(params[0]);
      return { rows: user ? [{ ...user, role_name: user.role }] : [] };
    }
    if (text.startsWith("UPDATE users SET mfa_pending_secret_encrypted = $1")) {
      byId(params[1]).mfa_pending_secret_encrypted = params[0];
      return { rows: [] };
    }
    if (text.startsWith("UPDATE users SET mfa_enabled = TRUE")) {
      Object.assign(byId(params[3]), {
        mfa_enabled: true,
        mfa_secret_encrypted: params[0],
        mfa_pending_secret_encrypted: null,
        mfa_last_used_step: params[1],
        mfa_recovery_codes_hash: JSON.parse(params[2]),
        token_version: Number(byId(params[3]).token_version || 0) + 1,
      });
      return { rows: [] };
    }
    if (text.startsWith("UPDATE users SET mfa_last_used_step = $1")) {
      const user = byId(params[1]);
      const guarded = text.includes("(mfa_last_used_step IS NULL OR mfa_last_used_step < $1)");
      if (!guarded || user.mfa_last_used_step === null || user.mfa_last_used_step === undefined || user.mfa_last_used_step < params[0]) {
        user.mfa_last_used_step = params[0];
        return { rows: [{ id: user.id }] };
      }
      return { rows: [] };
    }
    if (text.startsWith("UPDATE users SET mfa_recovery_codes_hash = $1::jsonb WHERE id = $2 AND")) {
      const user = byId(params[1]);
      const wanted = JSON.parse(params[2])[0];
      if (!(user.mfa_recovery_codes_hash || []).includes(wanted)) return { rows: [] };
      user.mfa_recovery_codes_hash = JSON.parse(params[0]);
      return { rows: [{ id: user.id }] };
    }
    if (text.startsWith("UPDATE users SET password = $1, password_changed_at = NOW()")) {
      Object.assign(byId(params[2]), {
        password: params[0],
        password_changed_at: new Date(),
        must_change_password: params[1],
        token_version: Number(byId(params[2]).token_version || 0) + 1,
      });
      return { rows: [] };
    }
    return { rows: [], rowCount: 0 };
  };
  return { audit, restore: () => { db.query = original; } };
};

const makeRes = () => ({
  statusCode: 200,
  payload: null,
  headers: {},
  status(code) { this.statusCode = code; return this; },
  json(value) { this.payload = value; return this; },
  set(name, value) { this.headers[name] = value; return this; },
  once() {},
});

const request = (body = {}, extra = {}) => ({ body, headers: {}, query: {}, params: {}, method: "POST", originalUrl: "/api/auth/login", ...extra });

const makeUser = async (overrides = {}) => ({
  id: 501,
  tenant_id: null,
  name: "Store Owner",
  email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
  password: await bcrypt.hash("Str0ng-Passw0rd!", 4),
  role: "admin",
  is_active: true,
  is_super_admin: false,
  password_changed_at: new Date(),
  token_version: null,
  mfa_enabled: null,
  ...overrides,
});

const resetState = () => {
  clearSettingsCache();
  staffLoginFailuresByEmail.buckets.clear();
  mfaFailureCounter.buckets.clear();
};

// ------------------------------------------------------------------ flows

test("an MFA-enabled account gets no session from the password alone", async () => {
  resetState();
  const totpSecret = base32Encode(Buffer.from("staff-mfa-secret-0001"));
  const user = await makeUser({ mfa_enabled: true, mfa_secret_encrypted: sealMfaSecret(totpSecret), mfa_last_used_step: null });
  const fake = installFakeDb({ users: [user] });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.step, "mfa_required");
    assert.equal(res.payload.token, undefined);

    // The challenge token is not a session.
    const protectRes = makeRes();
    let passed = false;
    await protect({ headers: { authorization: `Bearer ${res.payload.challenge_token}` } }, protectRes, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(protectRes.statusCode, 401);

    const wrong = makeRes();
    await verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code: "000000" }), wrong);
    assert.equal(wrong.statusCode, 400);
    assert.equal(wrong.payload.token, undefined);

    const code = totpCodeAt(totpSecret, currentTotpStep());
    const ok = makeRes();
    await verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code }), ok);
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.payload.token);

    const replay = makeRes();
    await verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code }), replay);
    assert.equal(replay.statusCode, 400, "the same code must not open a second session");

    assert.ok(fake.audit.some((event) => event.event_type === "mfa_verify" && event.outcome === "success"));
    assert.ok(fake.audit.some((event) => event.event_type === "mfa_verify" && event.outcome === "failure"));
    assert.ok(!JSON.stringify(fake.audit).includes(code), "codes never reach the audit log");
  } finally {
    fake.restore();
  }
});

test("two simultaneous requests with the same code open only one session", async () => {
  resetState();
  const totpSecret = base32Encode(Buffer.from("staff-mfa-secret-0004"));
  const user = await makeUser({ id: 509, mfa_enabled: true, mfa_secret_encrypted: sealMfaSecret(totpSecret), mfa_last_used_step: null });
  const fake = installFakeDb({ users: [user] });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), res);
    const code = totpCodeAt(totpSecret, currentTotpStep());
    const [a, b] = [makeRes(), makeRes()];
    await Promise.all([
      verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code }), a),
      verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code }), b),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 400]);
  } finally {
    fake.restore();
  }
});

test("five wrong MFA codes lock the second step", async () => {
  resetState();
  const totpSecret = base32Encode(Buffer.from("staff-mfa-secret-0002"));
  const user = await makeUser({ id: 502, mfa_enabled: true, mfa_secret_encrypted: sealMfaSecret(totpSecret) });
  const fake = installFakeDb({ users: [user] });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), res);
    for (let i = 0; i < 5; i += 1) {
      const attempt = makeRes();
      await verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code: "111111" }), attempt);
      assert.equal(attempt.statusCode, 400);
    }
    const locked = makeRes();
    await verifyLoginMfa(request({ challenge_token: res.payload.challenge_token, code: totpCodeAt(totpSecret, currentTotpStep()) }), locked);
    assert.equal(locked.statusCode, 429);
    assert.equal(locked.payload.token, undefined);
  } finally {
    fake.restore();
  }
});

test("a recovery code works once", async () => {
  resetState();
  const { hashRecoveryCode } = await import("../server/modules/security/mfaSecretBox.js");
  const user = await makeUser({
    id: 503,
    mfa_enabled: true,
    mfa_secret_encrypted: sealMfaSecret(base32Encode(Buffer.from("staff-mfa-secret-0003"))),
    mfa_recovery_codes_hash: [hashRecoveryCode("ABCDE-FGHJK")],
  });
  const fake = installFakeDb({ users: [user] });
  try {
    const first = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), first);
    const ok = makeRes();
    await verifyLoginMfa(request({ challenge_token: first.payload.challenge_token, code: "abcde-fghjk" }), ok);
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.payload.recovery_codes_remaining, 0);

    const second = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), second);
    const again = makeRes();
    await verifyLoginMfa(request({ challenge_token: second.payload.challenge_token, code: "ABCDE-FGHJK" }), again);
    assert.equal(again.statusCode, 400);
  } finally {
    fake.restore();
  }
});

test("with MFA required, an admin who has not enrolled must enrol before getting a session", async () => {
  resetState();
  const user = await makeUser({ id: 504 });
  const fake = installFakeDb({ users: [user], settings: { "security.mfa_required": true } });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), res);
    assert.equal(res.payload.step, "mfa_enrollment_required");
    assert.equal(res.payload.token, undefined);

    const start = makeRes();
    await startLoginMfaEnrollment(request({ challenge_token: res.payload.challenge_token }), start);
    assert.equal(start.statusCode, 200);
    assert.match(start.payload.qr_data_url, /^data:image\/png;base64,/);
    assert.match(start.payload.otpauth_uri, /^otpauth:\/\/totp\//);
    const secret = new URL(start.payload.otpauth_uri).searchParams.get("secret");
    assert.notEqual(user.mfa_pending_secret_encrypted, secret, "stored sealed, not in clear");

    const confirm = makeRes();
    await confirmLoginMfaEnrollment(request({ challenge_token: res.payload.challenge_token, code: totpCodeAt(secret, currentTotpStep()) }), confirm);
    assert.equal(confirm.statusCode, 200);
    assert.ok(confirm.payload.token);
    assert.equal(confirm.payload.recovery_codes.length, 10);
    assert.equal(user.mfa_enabled, true);
    assert.equal(user.mfa_recovery_codes_hash.length, 10);
    assert.ok(!user.mfa_recovery_codes_hash.includes(confirm.payload.recovery_codes[0]), "recovery codes are stored hashed");

    // Enrolment bumped the session generation, so the enrolment token is now spent.
    const reuse = makeRes();
    await startLoginMfaEnrollment(request({ challenge_token: res.payload.challenge_token }), reuse);
    assert.equal(reuse.statusCode, 401);
  } finally {
    fake.restore();
  }
});

test("a cashier is not forced into MFA when it is required only for admins and Amazon users", async () => {
  resetState();
  const user = await makeUser({ id: 505, role: "cashier" });
  const fake = installFakeDb({ users: [user], settings: { "security.mfa_required": true } });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "Str0ng-Passw0rd!" }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.payload.token);
  } finally {
    fake.restore();
  }
});

test("with rotation enforced, a weak or expired password must be changed first", async () => {
  resetState();
  const user = await makeUser({ id: 506, password: await bcrypt.hash("weakpass", 4), password_changed_at: null });
  const fake = installFakeDb({ users: [user], settings: { "security.enforce_password_rotation": true } });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "weakpass" }), res);
    assert.equal(res.payload.step, "password_change_required");
    assert.deepEqual(res.payload.password_status.reasons, ["weak"]);
    assert.equal(res.payload.token, undefined);

    const rejected = makeRes();
    await changeExpiredPassword(request({ challenge_token: res.payload.challenge_token, current_password: "weakpass", new_password: "still-weak" }), rejected);
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.payload.code, "PASSWORD_POLICY");

    const changed = makeRes();
    await changeExpiredPassword(request({ challenge_token: res.payload.challenge_token, current_password: "weakpass", new_password: "N3w-Str0ng-Pass!" }), changed);
    assert.equal(changed.statusCode, 200);
    assert.equal(await bcrypt.compare("N3w-Str0ng-Pass!", user.password), true);
    assert.equal(user.token_version, 1);

    const again = makeRes();
    await login(request({ email: user.email, password: "N3w-Str0ng-Pass!" }), again);
    assert.ok(again.payload.token);
  } finally {
    fake.restore();
  }
});

test("rotation not enforced yet: a weak password still signs in and reports its status", async () => {
  resetState();
  const user = await makeUser({ id: 507, password: await bcrypt.hash("weakpass", 4) });
  const fake = installFakeDb({ users: [user] });
  try {
    const res = makeRes();
    await login(request({ email: user.email, password: "weakpass" }), res);
    assert.ok(res.payload.token);
    assert.equal(res.payload.password_status.compliant, false);
  } finally {
    fake.restore();
  }
});

test("protect rejects a session minted before a password or MFA change", async () => {
  const user = await makeUser({ id: 508, token_version: 2 });
  const fake = installFakeDb({ users: [user] });
  try {
    const stale = jwt.sign({ id: 508, role: "admin", tv: 1 }, SECRET);
    const res = makeRes();
    let passed = false;
    await protect({ headers: { authorization: `Bearer ${stale}` } }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.payload.code, "SESSION_REVOKED");

    const current = jwt.sign({ id: 508, role: "admin", tv: 2 }, SECRET);
    const req = { headers: { authorization: `Bearer ${current}` } };
    await protect(req, makeRes(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal("mfa_secret_encrypted" in req.user, false);
  } finally {
    fake.restore();
  }
});

test("protect fails closed when the account lookup errors", async () => {
  const original = db.query.bind(db);
  db.query = async () => { throw new Error("db down"); };
  try {
    const token = jwt.sign({ id: 9, role: "admin" }, SECRET);
    const res = makeRes();
    let passed = false;
    await protect({ headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 503);
  } finally {
    db.query = original;
  }
});

test("Amazon routes need an MFA-enabled account and are audited", async () => {
  const fake = installFakeDb({ users: [] });
  try {
    const gate = requireAmazonAccess("view");
    const noMfa = makeRes();
    let passed = false;
    await gate({ user: { id: 1, role: "admin", mfa_enabled: false }, headers: {}, method: "GET", originalUrl: "/api/security/amazon-access-check" }, noMfa, () => { passed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(passed, false);
    assert.equal(noMfa.statusCode, 403);
    assert.equal(noMfa.payload.code, "MFA_REQUIRED_FOR_AMAZON");

    const withMfa = makeRes();
    await gate({ user: { id: 1, role: "admin", mfa_enabled: true }, headers: {}, method: "GET", originalUrl: "/api/security/amazon-access-check" }, withMfa, () => { passed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(passed, true);
    assert.deepEqual(
      fake.audit.filter((event) => event.event_type === "amazon_access").map((event) => event.outcome),
      ["denied_mfa_missing", "allowed"]
    );
  } finally {
    fake.restore();
  }
});
