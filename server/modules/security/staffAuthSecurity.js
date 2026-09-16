import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import QRCode from "qrcode";

import db from "../../database/db.js";
import { getSetting } from "../../services/settingsService.js";
import { createSlidingWindowCounter } from "../../utils/requestRateLimit.js";
import {
  DEFAULT_PASSWORD_MAX_AGE_DAYS,
  assessPasswordStatus,
  validateStaffPassword,
} from "./passwordPolicy.js";
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  openMfaSecret,
  sealMfaSecret,
} from "./mfaSecretBox.js";
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from "./totp.js";
import { recordSecurityEvent } from "./securityAudit.js";

export const BCRYPT_COST = 12;
const MINUTE_MS = 60_000;

// ------------------------------------------------------------------ policy switches

export const getStaffSecurityPolicy = async () => {
  const read = async (key, fallback) => {
    try {
      const value = await getSetting(key, fallback);
      return value === undefined || value === null ? fallback : value;
    } catch {
      return fallback;
    }
  };
  const maxAge = Number(await read("security.password_max_age_days", DEFAULT_PASSWORD_MAX_AGE_DAYS));
  return {
    requireStrongPassword: (await read("security.require_strong_password", true)) !== false,
    enforcePasswordRotation: (await read("security.enforce_password_rotation", false)) === true,
    passwordMaxAgeDays: Number.isFinite(maxAge) && maxAge > 0 ? Math.min(maxAge, DEFAULT_PASSWORD_MAX_AGE_DAYS) : DEFAULT_PASSWORD_MAX_AGE_DAYS,
    mfaRequired: (await read("security.mfa_required", false)) === true,
  };
};

const ADMIN_ROLE_NAMES = new Set(["admin", "super admin", "superadmin", "platform admin", "owner", "manager"]);
const normalizeRole = (value) => String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");

// Who must use MFA once `security.mfa_required` is on: administrators and anyone who can reach
// Amazon Information.
export const userRequiresMfa = (user = {}, permissions = []) =>
  user.is_super_admin === true ||
  ADMIN_ROLE_NAMES.has(normalizeRole(user.role)) ||
  ADMIN_ROLE_NAMES.has(normalizeRole(user.role_name)) ||
  (permissions || []).some((permission) => /^amazon[.:]/i.test(String(permission || "")) || permission === "*");

// ------------------------------------------------------------------ short-lived step tokens

const jwtSecret = () => process.env.JWT_SECRET || "SECRET_KEY";

export const STEP_TOKEN_TYPES = Object.freeze({
  MFA_CHALLENGE: "staff_mfa_challenge",
  MFA_ENROLL: "staff_mfa_enroll",
  PASSWORD_CHANGE: "staff_password_change",
});

// These carry a `type`, so `protect` (isStaffSessionToken) never accepts them as a session.
export const signStepToken = (type, user, ttlSeconds) =>
  jwt.sign(
    { type, uid: user.id, tid: user.tenant_id ?? null, tv: Number(user.token_version || 0) },
    jwtSecret(),
    { expiresIn: ttlSeconds }
  );

export const readStepToken = (token, allowedTypes = []) => {
  try {
    const decoded = jwt.verify(String(token || ""), jwtSecret());
    if (!allowedTypes.includes(decoded?.type) || !decoded?.uid) return null;
    return decoded;
  } catch {
    return null;
  }
};

// ------------------------------------------------------------------ user security row

export const loadStaffSecurityRow = async (userId) => {
  const result = await db.query(
    `
    SELECT u.id, u.tenant_id, u.name, u.email, u.is_active, u.is_super_admin, u.account_expires_at,
           u.password, u.password_changed_at, u.must_change_password, u.token_version,
           u.mfa_enabled, u.mfa_secret_encrypted, u.mfa_pending_secret_encrypted,
           u.mfa_enrolled_at, u.mfa_last_used_step, u.mfa_recovery_codes_hash,
           r.name AS role_name
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
};

export const stepTokenStillValid = (decoded, row) =>
  Boolean(row) && row.is_active !== false && Number(row.token_version || 0) === Number(decoded?.tv || 0);

export const publicMfaStatus = (row = {}) => ({
  enabled: row.mfa_enabled === true,
  enrolled_at: row.mfa_enrolled_at || null,
  recovery_codes_remaining: Array.isArray(row.mfa_recovery_codes_hash) ? row.mfa_recovery_codes_hash.length : 0,
});

// ------------------------------------------------------------------ password

export const checkNewStaffPassword = async (password, identity = {}) => {
  const policy = await getStaffSecurityPolicy();
  if (!policy.requireStrongPassword) return { valid: true, errors: [], messages: [] };
  return validateStaffPassword(password, identity);
};

export const assessLoginPassword = async (row, plainPassword) => {
  const policy = await getStaffSecurityPolicy();
  const status = assessPasswordStatus({ user: row, plainPassword, maxAgeDays: policy.passwordMaxAgeDays });
  return { policy, status, mustChangeNow: policy.enforcePasswordRotation && status.change_required };
};

// Sets a new password, stamps the rotation clock and revokes every existing session.
export const setStaffPassword = async (userId, newPassword, { mustChange = false } = {}) => {
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.query(
    `
    UPDATE users
    SET password = $1,
        password_changed_at = NOW(),
        must_change_password = $2,
        token_version = COALESCE(token_version, 0) + 1,
        updated_at = NOW()
    WHERE id = $3
    `,
    [hash, mustChange, userId]
  );
};

export const changeOwnPassword = async ({ req, row, currentPassword, newPassword }) => {
  if (!row?.password || !(await bcrypt.compare(String(currentPassword || ""), row.password))) {
    await recordSecurityEvent({ req, eventType: "password_change", outcome: "failure", userId: row?.id, tenantId: row?.tenant_id, actorUserId: row?.id, details: { reason_code: "current_password_wrong" } });
    return { ok: false, status: 400, code: "CURRENT_PASSWORD_WRONG", message: "كلمة المرور الحالية غير صحيحة" };
  }
  const verdict = validateStaffPassword(newPassword, { email: row.email, name: row.name });
  if (!verdict.valid) {
    return { ok: false, status: 400, code: "PASSWORD_POLICY", message: verdict.messages.join(" • "), errors: verdict.errors };
  }
  if (await bcrypt.compare(String(newPassword), row.password)) {
    return { ok: false, status: 400, code: "PASSWORD_REUSED", message: "كلمة المرور الجديدة لازم تكون مختلفة عن الحالية" };
  }
  await setStaffPassword(row.id, newPassword, { mustChange: false });
  await recordSecurityEvent({ req, eventType: "password_change", outcome: "success", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id });
  return { ok: true };
};

// ------------------------------------------------------------------ MFA

const mfaFailuresByUser = createSlidingWindowCounter({ windowMs: 15 * MINUTE_MS, max: 5 });
export const mfaFailureCounter = mfaFailuresByUser;

export const startMfaEnrollment = async (row) => {
  const secret = generateTotpSecret();
  await db.query(`UPDATE users SET mfa_pending_secret_encrypted = $1 WHERE id = $2`, [sealMfaSecret(secret), row.id]);
  const otpauthUri = buildOtpauthUri({ secret, accountName: row.email || `user-${row.id}` });
  // The QR is rendered here, not by a third-party service, so the secret never leaves the server
  // except to the user enrolling.
  const qrDataUrl = await QRCode.toDataURL(otpauthUri, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  return { otpauth_uri: otpauthUri, qr_data_url: qrDataUrl, manual_entry_key: secret.match(/.{1,4}/g).join(" ") };
};

export const confirmMfaEnrollment = async ({ req, row, code }) => {
  const key = `mfa:${row.id}`;
  const lockedFor = mfaFailuresByUser.retryAfterSeconds(key);
  if (lockedFor > 0) return { ok: false, status: 429, retryAfter: lockedFor };
  if (!row.mfa_pending_secret_encrypted) {
    return { ok: false, status: 400, code: "NO_PENDING_ENROLLMENT", message: "ابدأ التفعيل من جديد" };
  }
  let secret;
  try {
    secret = openMfaSecret(row.mfa_pending_secret_encrypted);
  } catch {
    return { ok: false, status: 400, code: "NO_PENDING_ENROLLMENT", message: "ابدأ التفعيل من جديد" };
  }
  const step = verifyTotp(secret, code);
  if (step === null) {
    mfaFailuresByUser.hit(key);
    await recordSecurityEvent({ req, eventType: "mfa_enroll", outcome: "failure", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id, details: { reason_code: "bad_code" } });
    return { ok: false, status: 400, code: "MFA_CODE_INVALID", message: "الكود غير صحيح، تأكد من الوقت على الموبايل وحاول تاني" };
  }
  mfaFailuresByUser.reset(key);
  const recoveryCodes = generateRecoveryCodes();
  await db.query(
    `
    UPDATE users
    SET mfa_enabled = TRUE,
        mfa_secret_encrypted = $1,
        mfa_pending_secret_encrypted = NULL,
        mfa_enrolled_at = NOW(),
        mfa_last_used_step = $2,
        mfa_recovery_codes_hash = $3::jsonb,
        token_version = COALESCE(token_version, 0) + 1
    WHERE id = $4
    `,
    [sealMfaSecret(secret), step, JSON.stringify(recoveryCodes.map(hashRecoveryCode)), row.id]
  );
  await recordSecurityEvent({ req, eventType: "mfa_enroll", outcome: "success", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id });
  return { ok: true, recoveryCodes };
};

// Accepts a 6-digit TOTP code or a single-use recovery code.
export const verifyMfaForLogin = async ({ req, row, code }) => {
  const key = `mfa:${row.id}`;
  const lockedFor = mfaFailuresByUser.retryAfterSeconds(key);
  if (lockedFor > 0) {
    await recordSecurityEvent({ req, eventType: "mfa_verify", outcome: "locked", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id });
    return { ok: false, status: 429, retryAfter: lockedFor };
  }
  if (row.mfa_enabled !== true || !row.mfa_secret_encrypted) {
    return { ok: false, status: 400, code: "MFA_NOT_ENABLED", message: "التحقق الثنائي غير مفعّل لهذا الحساب" };
  }
  const raw = String(code || "").trim();

  if (/^\d{6}$/.test(raw.replace(/\s+/g, ""))) {
    let secret;
    try {
      secret = openMfaSecret(row.mfa_secret_encrypted);
    } catch (error) {
      console.error("[security] MFA secret could not be opened", { userId: row.id, message: error?.message });
      await recordSecurityEvent({ req, eventType: "mfa_verify", outcome: "error", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id, details: { reason_code: "secret_unreadable" } });
      return { ok: false, status: 500, code: "MFA_UNAVAILABLE", message: "تعذر التحقق، استخدم كود استرجاع أو تواصل مع المدير" };
    }
    const step = verifyTotp(secret, raw, { lastUsedStep: row.mfa_last_used_step });
    if (step !== null) {
      // Conditional update: a concurrent request with the same code loses the race.
      const updated = await db.query(
        `UPDATE users SET mfa_last_used_step = $1 WHERE id = $2 AND (mfa_last_used_step IS NULL OR mfa_last_used_step < $1) RETURNING id`,
        [step, row.id]
      );
      if (updated.rows.length) {
        mfaFailuresByUser.reset(key);
        await recordSecurityEvent({ req, eventType: "mfa_verify", outcome: "success", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id, details: { method: "totp" } });
        return { ok: true, method: "totp" };
      }
    }
  } else if (raw.length >= 10) {
    const hashed = hashRecoveryCode(raw);
    const codes = Array.isArray(row.mfa_recovery_codes_hash) ? row.mfa_recovery_codes_hash : [];
    if (codes.includes(hashed)) {
      const remaining = codes.filter((value) => value !== hashed);
      const updated = await db.query(
        `UPDATE users SET mfa_recovery_codes_hash = $1::jsonb WHERE id = $2 AND mfa_recovery_codes_hash @> $3::jsonb RETURNING id`,
        [JSON.stringify(remaining), row.id, JSON.stringify([hashed])]
      );
      if (updated.rows.length) {
        mfaFailuresByUser.reset(key);
        await recordSecurityEvent({ req, eventType: "mfa_verify", outcome: "success", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id, details: { method: "recovery_code", recovery_codes_remaining: remaining.length } });
        return { ok: true, method: "recovery_code", recoveryCodesRemaining: remaining.length };
      }
    }
  }

  mfaFailuresByUser.hit(key);
  await recordSecurityEvent({ req, eventType: "mfa_verify", outcome: "failure", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id });
  return { ok: false, status: 400, code: "MFA_CODE_INVALID", message: "الكود غير صحيح" };
};

export const regenerateRecoveryCodes = async ({ req, row }) => {
  const recoveryCodes = generateRecoveryCodes();
  await db.query(`UPDATE users SET mfa_recovery_codes_hash = $1::jsonb WHERE id = $2`, [JSON.stringify(recoveryCodes.map(hashRecoveryCode)), row.id]);
  await recordSecurityEvent({ req, eventType: "mfa_recovery_codes_regenerated", outcome: "success", userId: row.id, tenantId: row.tenant_id, actorUserId: row.id });
  return recoveryCodes;
};

export const clearMfa = async ({ req, targetRow, actorUserId, eventType }) => {
  await db.query(
    `
    UPDATE users
    SET mfa_enabled = FALSE,
        mfa_secret_encrypted = NULL,
        mfa_pending_secret_encrypted = NULL,
        mfa_enrolled_at = NULL,
        mfa_last_used_step = NULL,
        mfa_recovery_codes_hash = NULL,
        token_version = COALESCE(token_version, 0) + 1
    WHERE id = $1
    `,
    [targetRow.id]
  );
  await recordSecurityEvent({ req, eventType, outcome: "success", userId: targetRow.id, tenantId: targetRow.tenant_id, actorUserId });
};
