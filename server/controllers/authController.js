import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { sendTooManyAttempts } from "../utils/requestRateLimit.js";
import { stripSensitiveUserFields } from "../utils/sanitizeUser.js";
import { staffLoginEmailKey, staffLoginFailuresByEmail } from "../utils/staffLoginThrottle.js";
import { sendLoginTaskDigestIfNeeded } from "../services/staffTaskEmailNotificationService.js";
import { ensureStaffTasksSchema, resolveEmployeeForUser } from "../services/staffTasksService.js";
import { ensureDefaultTenantAndBackfillUsers } from "../utils/tenantBootstrap.js";
import { isMetaReviewerRole, metaReviewerAccountExpired } from "../services/metaReviewerAccessService.js";
import { isPortalInboxRole } from "../modules/aiInboxPortal/portalInboxAccess.js";
import { recordSecurityEvent } from "../modules/security/securityAudit.js";
import { passwordPolicyErrorResponse } from "../modules/security/passwordPolicy.js";
import {
  BCRYPT_COST,
  STEP_TOKEN_TYPES,
  checkNewStaffPassword,
  assessLoginPassword,
  changeOwnPassword,
  clearMfa,
  confirmMfaEnrollment,
  getStaffSecurityPolicy,
  loadStaffSecurityRow,
  publicMfaStatus,
  readStepToken,
  regenerateRecoveryCodes,
  signStepToken,
  startMfaEnrollment,
  stepTokenStillValid,
  userRequiresMfa,
  verifyMfaForLogin,
} from "../modules/security/staffAuthSecurity.js";

// Boot runs this before listen(); login used to run it again on EVERY sign-in, and each run is two
// ALTER TABLE users, which lock the table every authenticated request reads.
let usersLoginSchemaVerified = false;

export const ensureUsersLoginSchema = async () => {
  if (usersLoginSchemaVerified) return;
  const before = await db.query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'last_login_at'
    LIMIT 1
    `
  );
  console.log("[schema] users.last_login_at before", {
    exists: before.rows.length > 0,
    definition: before.rows[0] || null,
  });
  await db.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS account_expires_at TIMESTAMPTZ NULL`);
  const after = await db.query(
    `
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'users'
      AND column_name = 'last_login_at'
    LIMIT 1
    `
  );
  console.log("[schema] users.last_login_at after", {
    exists: after.rows.length > 0,
    definition: after.rows[0] || null,
  });
  usersLoginSchemaVerified = true;
};

let usersColumnNamesPromise = null;

const getUsersColumnNames = async () => {
  if (!usersColumnNamesPromise) {
    usersColumnNamesPromise = db
      .query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
        `
      )
      .then((result) => new Set(result.rows.map((row) => String(row.column_name || "").toLowerCase())))
      .catch((error) => {
        usersColumnNamesPromise = null;
        throw error;
      });
  }
  return usersColumnNamesPromise;
};

const getReadablePasswordColumns = (userColumns) =>
  ["password", "password_hash", "hashed_password", "password_digest"].filter((column) => userColumns.has(column));

const resolveLoginTenantId = async (req) => {
  const rawTenant =
    req?.tenantId ??
    req?.tenant?.id ??
    req?.user?.tenant_id ??
    req?.user?.tenantId ??
    req?.headers?.["x-tenant-id"] ??
    req?.query?.tenant_id ??
    req?.query?.tenantId ??
    req?.body?.tenant_id ??
    req?.body?.tenantId;

  if (rawTenant !== null && rawTenant !== undefined && String(rawTenant).trim() !== "") {
    const numericTenant = Number(rawTenant);
    if (Number.isFinite(numericTenant) && numericTenant > 0) {
      return numericTenant;
    }
  }

  const workspaceHint =
    String(req?.body?.tenant_slug || req?.body?.workspace || req?.body?.tenant || "").trim();

  if (!workspaceHint) {
    return null;
  }

  const tenantResult = await db.query(
    `
    SELECT id
    FROM tenants
    WHERE LOWER(slug) = LOWER($1)
       OR LOWER(name) = LOWER($1)
    ORDER BY id ASC
    LIMIT 1
    `,
    [workspaceHint]
  );

  return tenantResult.rows[0]?.id ? Number(tenantResult.rows[0].id) : null;
};

const buildLoginUserSelect = (passwordColumns = []) => {
  const selectColumns = [
    "u.id",
    "u.tenant_id",
    "u.role_id",
    "u.name",
    "u.email",
    "u.phone",
    "u.is_active",
    "u.is_super_admin",
    "u.last_login_at",
    "u.account_expires_at",
    "u.created_at",
    "u.updated_at",
    ...passwordColumns.map((column) => `u.${column} AS ${column}`),
    "r.name AS role_name",
  ];

  return `
      SELECT
        ${selectColumns.join(",\n        ")}
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE LOWER(u.email) = LOWER($1)
    `;
};

const resolveUserPasswordValue = (user, passwordColumns = []) => {
  for (const column of passwordColumns) {
    const value = user?.[column];
    if (typeof value === "string" && value.trim()) {
      return { column, value };
    }
  }
  return { column: null, value: null };
};

const generateToken = (user) => {
  const reviewer = isMetaReviewerRole(user.role);
  const remainingSeconds = reviewer
    ? Math.floor((new Date(user.account_expires_at).getTime() - Date.now()) / 1000)
    : null;
  const expiresIn = reviewer ? Math.max(1, Math.min(8 * 60 * 60, remainingSeconds)) : "7d";
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      tenant_id: user.tenant_id ?? null,
      is_super_admin: Boolean(user.is_super_admin),
      // Session generation: a password change or MFA change bumps users.token_version and every
      // older token stops passing protect().
      tv: Number(user.token_version || 0),
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn }
  );
};

const getUserPermissions = async (userId) => {
  const permissions = await db.query(
    `
    SELECT DISTINCT p.module, p.action
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE u.id = $1
    `,
    [userId]
  );

  return permissions.rows
    .filter(({ module, action }) => module && action)
    .map(({ module, action }) => `${module}.${action}`);
};

const getRoleName = (user = {}, fallback = "user") =>
  user.role || user.role_name || (user.is_super_admin ? "super_admin" : fallback);

const reviewerPresentation = (role = "") => isMetaReviewerRole(role)
  ? { role: "admin", role_name: "admin", account_mode: "meta_reviewer" }
  : { role, role_name: role, account_mode: "standard" };

export const register = async (req, res) => {
  try {
    const { name, email, password, role_id, role } = req.body;
    const defaultTenantId = await ensureDefaultTenantAndBackfillUsers();

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All Fields Required",
      });
    }

    const exists = await db.query(
      `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      `,
      [email]
    );

    if (exists.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email Already Exists",
      });
    }

    const registerVerdict = await checkNewStaffPassword(password, { email, name });
    if (!registerVerdict.valid) {
      return res.status(400).json(passwordPolicyErrorResponse(registerVerdict));
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_COST);
    const roleResult = await db.query(
      `
      SELECT id, name
      FROM roles
      WHERE id = $1
      `,
      [role_id || null]
    );

    const normalizedRole = roleResult.rows[0]?.name || role || "user";

    if (isMetaReviewerRole(normalizedRole)) {
      return res.status(403).json({ success: false, message: "Reserved roles require the secure administrative command." });
    }

    const createdUser = await db.query(
      `
      INSERT INTO users (
        tenant_id,
        name,
        email,
        password,
        role_id,
        role
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, tenant_id, name, email, role_id, role
      `,
      [defaultTenantId, name, email, hashedPassword, role_id || null, normalizedRole]
    );

    const user = createdUser.rows[0];
    const permissions = await getUserPermissions(user.id);

    const token = generateToken({
      id: user.id,
      role: getRoleName(user, normalizedRole || "user"),
      tenant_id: user.tenant_id,
      is_super_admin: Boolean(user.is_super_admin),
    });

    return res.status(201).json({
      success: true,
      message: "User Registered Successfully",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: getRoleName(user, normalizedRole || "user"),
        role_name: getRoleName(user, normalizedRole || "user"),
        tenant_id: user.tenant_id,
        is_super_admin: Boolean(user.is_super_admin),
        permissions,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Register",
      error: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    await ensureDefaultTenantAndBackfillUsers();
    await ensureUsersLoginSchema().catch((error) => {
      console.warn("[schema] users.last_login_at ensure skipped during login", {
        message: error?.message || String(error),
      });
    });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email And Password Required",
      });
    }

    const failureKey = staffLoginEmailKey(email);
    const lockedFor = failureKey ? staffLoginFailuresByEmail.retryAfterSeconds(failureKey) : 0;
    if (lockedFor > 0) {
      console.warn("[auth] login refused: account temporarily locked", { retryAfterSeconds: lockedFor });
      await recordSecurityEvent({ req, eventType: "login", outcome: "locked", details: { email: String(email).trim().toLowerCase() } });
      return sendTooManyAttempts(res, lockedFor);
    }

    const tenantId = await resolveLoginTenantId(req);
    const userColumns = await getUsersColumnNames();
    const passwordColumns = getReadablePasswordColumns(userColumns);
    console.log("[auth] login lookup", {
      source: "users",
      emailProvided: Boolean(String(email || "").trim()),
      tenantId,
      passwordColumns,
    });

    const loginSelect = buildLoginUserSelect(passwordColumns);
    let result = { rows: [] };

    if (tenantId !== null) {
      const exactTenantSql = `
        ${loginSelect}
          AND u.tenant_id = $2
        ORDER BY
          CASE WHEN u.tenant_id = $2 THEN 0 ELSE 1 END,
          u.id ASC
        `;
      result = await db.query(
        exactTenantSql,
        [email.trim(), tenantId]
      );
      console.log("[auth] login exact tenant lookup", {
        emailProvided: true,
        tenantId,
        matchCount: result.rows.length,
      });
    }

    if (result.rows.length === 0) {
      console.log("[auth] login fallback lookup", {
        emailProvided: true,
        tenantId,
        reason: tenantId !== null ? "exact_tenant_miss" : "no_tenant_provided",
      });
      const fallbackSql = `
        ${loginSelect}
          AND u.is_active IS DISTINCT FROM FALSE
          AND (
            u.tenant_id IS NULL
            OR LOWER(COALESCE(t.status, 'active')) IN ('active', 'enabled', 'true', '1')
          )
        ORDER BY
          CASE WHEN u.tenant_id IS NULL THEN 1 ELSE 0 END,
          u.id ASC
        `;
      result = await db.query(
        fallbackSql,
        [email.trim()]
      );
    }

    if (result.rows.length === 0) {
      console.log("[auth] login user not found", {
        emailProvided: true,
        tenantId,
      });
      if (failureKey) staffLoginFailuresByEmail.hit(failureKey);
      await recordSecurityEvent({ req, eventType: "login", outcome: "failure", details: { reason_code: "unknown_user", email: String(email).trim().toLowerCase() } });
      return res.status(400).json({
        success: false,
        message: "Invalid Email Or Password",
      });
    }

    console.log("[auth] login user candidates found", {
      emailProvided: true,
      tenantId,
      fallbackUsed: tenantId === null,
      candidates: result.rows.map((candidate) => ({
        id: candidate.id,
        tenant_id: candidate.tenant_id,
        is_active: candidate.is_active,
      })),
    });

    if (tenantId === null) {
      if (result.rows.length > 1) {
        console.warn("[auth] login workspace required", {
          emailProvided: true,
          tenantId,
          candidateTenantIds: result.rows.map((candidate) => candidate.tenant_id ?? null),
        });
        return res.status(400).json({
          success: false,
          message: "Workspace Required",
        });
      }
    }

    let user = null;
    for (const candidate of result.rows) {
      const { column: passwordColumn, value: passwordValue } = resolveUserPasswordValue(candidate, passwordColumns);
      if (!passwordColumn || !passwordValue) {
        console.warn("[auth] login password column missing", {
          userId: candidate.id,
          tenantId: candidate.tenant_id ?? null,
          availableColumns: passwordColumns,
        });
        continue;
      }
      const isCandidateMatch = await bcrypt.compare(password, passwordValue);
      console.log("[auth] login password compare", {
        userId: candidate.id,
        tenantId: candidate.tenant_id ?? null,
        passwordColumn,
        compareResult: isCandidateMatch,
      });
      if (isCandidateMatch) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      console.log("[auth] login password mismatch", {
        emailProvided: true,
        tenantId,
      });
      if (failureKey) staffLoginFailuresByEmail.hit(failureKey);
      await recordSecurityEvent({
        req,
        eventType: "login",
        outcome: "failure",
        userId: result.rows.length === 1 ? result.rows[0].id : null,
        tenantId: result.rows.length === 1 ? result.rows[0].tenant_id : null,
        details: { reason_code: "wrong_password", email: String(email).trim().toLowerCase() },
      });
      return res.status(400).json({
        success: false,
        message: "Invalid Email Or Password",
      });
    }

    if (user.is_active === false) {
      console.warn("[auth] login rejected inactive user", {
        userId: user.id,
        tenantId: user.tenant_id ?? null,
        reason: "is_active_false",
      });
      return res.status(403).json({
        success: false,
        message: "Account Disabled",
      });
    }

    // The hidden per-employee messages account opens only from the employee portal.
    if (isPortalInboxRole(getRoleName(user)) || /^portal-inbox-\d+@employee-portal\.invalid$/i.test(String(user.email || ""))) {
      return res.status(403).json({ success: false, message: "Account Disabled" });
    }

    if (isMetaReviewerRole(getRoleName(user)) && (!user.account_expires_at || metaReviewerAccountExpired(user.account_expires_at))) {
      return res.status(403).json({ success: false, message: "Temporary review account expired or is not configured." });
    }

    if (failureKey) staffLoginFailuresByEmail.reset(failureKey);
    const permissions = await getUserPermissions(user.id, user.tenant_id);

    // Password policy and MFA steps. The temporary Meta reviewer account keeps its own time-boxed
    // flow and is never an Amazon user.
    let passwordStatus = null;
    if (!isMetaReviewerRole(getRoleName(user))) {
      const securityRow = await loadStaffSecurityRow(user.id);
      const assessment = await assessLoginPassword(securityRow, password);
      passwordStatus = assessment.status;
      const auditBase = { req, userId: user.id, tenantId: user.tenant_id, actorUserId: user.id };

      if (assessment.mustChangeNow) {
        await recordSecurityEvent({ ...auditBase, eventType: "login", outcome: "password_change_required", details: { reasons: passwordStatus.reasons.join(",") } });
        return res.status(200).json({
          success: true,
          step: "password_change_required",
          challenge_token: signStepToken(STEP_TOKEN_TYPES.PASSWORD_CHANGE, securityRow, 15 * 60),
          password_status: passwordStatus,
        });
      }

      if (securityRow.mfa_enabled === true) {
        await recordSecurityEvent({ ...auditBase, eventType: "login", outcome: "mfa_challenge_issued" });
        return res.status(200).json({
          success: true,
          step: "mfa_required",
          challenge_token: signStepToken(STEP_TOKEN_TYPES.MFA_CHALLENGE, securityRow, 5 * 60),
        });
      }

      if (assessment.policy.mfaRequired && userRequiresMfa(user, permissions)) {
        await recordSecurityEvent({ ...auditBase, eventType: "login", outcome: "mfa_enrollment_required" });
        return res.status(200).json({
          success: true,
          step: "mfa_enrollment_required",
          challenge_token: signStepToken(STEP_TOKEN_TYPES.MFA_ENROLL, securityRow, 15 * 60),
        });
      }
      user.token_version = securityRow.token_version;
    }

    return await finishStaffLogin(req, res, user, { permissions, passwordStatus, mfaMethod: null });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Login",
    });
  }
};

// Issues the session once every step (password, policy, MFA) has passed.
const finishStaffLogin = async (req, res, user, { permissions, passwordStatus = null, mfaMethod = null, extra = {} }) => {
  try {
    await db.query(
      `
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [user.id]
    );
  } catch (loginUpdateError) {
    if (loginUpdateError.code !== "42703") {
      throw loginUpdateError;
    }
  }

  const token = generateToken({
    id: user.id,
    role: getRoleName(user),
    tenant_id: user.tenant_id,
    is_super_admin: Boolean(user.is_super_admin),
    account_expires_at: user.account_expires_at || null,
    token_version: user.token_version,
  });

  const tenantBranding = user.tenant_id
    ? await db.query(
        `
        SELECT
          t.id,
          t.slug,
          COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(t.name), ''), 'MONE') AS company_name,
          COALESCE(NULLIF(TRIM(t.company_logo_url), ''), NULLIF(TRIM(c.logo_url), ''), '') AS company_logo_url,
          COALESCE(NULLIF(TRIM(t.favicon_url), ''), NULLIF(TRIM(c.favicon_url), ''), '') AS favicon_url
        FROM tenants t
        LEFT JOIN company_profiles c ON c.tenant_id = t.id
        WHERE t.id = $1
        LIMIT 1
        `,
        [user.tenant_id]
      ).catch(() => ({ rows: [] }))
    : { rows: [] };
  const tenant = tenantBranding.rows[0]
    ? {
        id: tenantBranding.rows[0].id,
        slug: tenantBranding.rows[0].slug,
        name: tenantBranding.rows[0].company_name,
        companyName: tenantBranding.rows[0].company_name,
        company_logo_url: tenantBranding.rows[0].company_logo_url || "",
        companyLogoUrl: tenantBranding.rows[0].company_logo_url || "",
        favicon_url: tenantBranding.rows[0].favicon_url || "",
        faviconUrl: tenantBranding.rows[0].favicon_url || "",
      }
    : null;

  if (!isMetaReviewerRole(getRoleName(user))) void (async () => {
    try {
      await ensureStaffTasksSchema();
      const employee = await resolveEmployeeForUser(user, user.tenant_id);
      if (employee?.id) {
        await sendLoginTaskDigestIfNeeded(user.id, employee.id, user.tenant_id);
      }
    } catch (digestError) {
      console.warn("[auth] staff task login digest skipped", digestError.message);
    }
  })();

  await recordSecurityEvent({
    req,
    eventType: "login",
    outcome: "success",
    userId: user.id,
    tenantId: user.tenant_id,
    actorUserId: user.id,
    details: { mfa: mfaMethod || "none" },
  });

  const presentedRole = reviewerPresentation(getRoleName(user));
  return res.status(200).json({
    success: true,
    message: "Login Successful",
    token,
    tenant,
    password_status: passwordStatus,
    ...extra,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: presentedRole.role,
      role_name: presentedRole.role_name,
      account_mode: presentedRole.account_mode,
      tenant_id: user.tenant_id,
      company_name: tenant?.companyName || "",
      company_logo_url: tenant?.companyLogoUrl || "",
      favicon_url: tenant?.faviconUrl || "",
      is_super_admin: Boolean(user.is_super_admin),
      permissions,
      account_expires_at: user.account_expires_at || null,
    },
  });
};

const stepError = (res, result) => {
  if (result.status === 429) return sendTooManyAttempts(res, result.retryAfter);
  return res.status(result.status || 400).json({
    success: false,
    code: result.code,
    message: result.message,
    ...(result.errors ? { errors: result.errors } : {}),
  });
};

const INVALID_STEP = { success: false, code: "STEP_EXPIRED", message: "انتهت صلاحية الخطوة، سجّل الدخول مرة أخرى" };

const loadStepRow = async (req, types) => {
  const decoded = readStepToken(req.body?.challenge_token, types);
  if (!decoded) return null;
  const row = await loadStaffSecurityRow(decoded.uid);
  return stepTokenStillValid(decoded, row) ? row : null;
};

// POST /api/auth/login/mfa
export const verifyLoginMfa = async (req, res) => {
  try {
    const row = await loadStepRow(req, [STEP_TOKEN_TYPES.MFA_CHALLENGE]);
    if (!row) return res.status(401).json(INVALID_STEP);
    const result = await verifyMfaForLogin({ req, row, code: req.body?.code });
    if (!result.ok) return stepError(res, result);
    const permissions = await getUserPermissions(row.id, row.tenant_id);
    return await finishStaffLogin(req, res, row, {
      permissions,
      mfaMethod: result.method,
      extra: result.method === "recovery_code" ? { recovery_codes_remaining: result.recoveryCodesRemaining } : {},
    });
  } catch (error) {
    console.error("[auth] MFA login step failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "Failed To Login" });
  }
};

// POST /api/auth/login/mfa-enroll/start
export const startLoginMfaEnrollment = async (req, res) => {
  try {
    const row = await loadStepRow(req, [STEP_TOKEN_TYPES.MFA_ENROLL]);
    if (!row) return res.status(401).json(INVALID_STEP);
    return res.json({ success: true, ...(await startMfaEnrollment(row)) });
  } catch (error) {
    console.error("[auth] MFA enrolment start failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر بدء التفعيل" });
  }
};

// POST /api/auth/login/mfa-enroll/confirm - enrolling proves possession, so it completes the login.
export const confirmLoginMfaEnrollment = async (req, res) => {
  try {
    const row = await loadStepRow(req, [STEP_TOKEN_TYPES.MFA_ENROLL]);
    if (!row) return res.status(401).json(INVALID_STEP);
    const result = await confirmMfaEnrollment({ req, row, code: req.body?.code });
    if (!result.ok) return stepError(res, result);
    const fresh = await loadStaffSecurityRow(row.id);
    const permissions = await getUserPermissions(fresh.id, fresh.tenant_id);
    return await finishStaffLogin(req, res, fresh, {
      permissions,
      mfaMethod: "totp_enrollment",
      extra: { recovery_codes: result.recoveryCodes },
    });
  } catch (error) {
    console.error("[auth] MFA enrolment confirm failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر تأكيد التفعيل" });
  }
};

// POST /api/auth/login/password-change - the user signs in again with the new password afterwards.
export const changeExpiredPassword = async (req, res) => {
  try {
    const row = await loadStepRow(req, [STEP_TOKEN_TYPES.PASSWORD_CHANGE]);
    if (!row) return res.status(401).json(INVALID_STEP);
    const result = await changeOwnPassword({
      req,
      row,
      currentPassword: req.body?.current_password,
      newPassword: req.body?.new_password,
    });
    if (!result.ok) return stepError(res, result);
    return res.json({ success: true, step: "password_changed", message: "تم تغيير كلمة المرور، سجّل الدخول بالكلمة الجديدة" });
  } catch (error) {
    console.error("[auth] expired password change failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر تغيير كلمة المرور" });
  }
};

// ---------------------------------------------------------------- signed-in self-service

const sessionTokenFor = async (userId) => {
  const row = await loadStaffSecurityRow(userId);
  return generateToken({
    id: row.id,
    role: getRoleName(row),
    tenant_id: row.tenant_id,
    is_super_admin: Boolean(row.is_super_admin),
    account_expires_at: row.account_expires_at || null,
    token_version: row.token_version,
  });
};

// GET /api/auth/security
export const getMySecurity = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    const policy = await getStaffSecurityPolicy();
    const permissions = await getUserPermissions(row.id, row.tenant_id);
    const { status } = await assessLoginPassword(row, undefined);
    return res.json({
      success: true,
      mfa: publicMfaStatus(row),
      mfa_required_for_you: policy.mfaRequired && userRequiresMfa(row, permissions),
      mfa_applies_to_you: userRequiresMfa(row, permissions),
      password: {
        changed_at: row.password_changed_at || null,
        expires_at: status.expires_at,
        days_left: status.days_left,
        must_change: status.must_change,
      },
      policy: {
        min_length: 12,
        requires: ["upper", "lower", "digit", "special"],
        max_age_days: policy.passwordMaxAgeDays,
        enforce_password_rotation: policy.enforcePasswordRotation,
        mfa_required: policy.mfaRequired,
      },
    });
  } catch (error) {
    console.error("[auth] security status failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر تحميل إعدادات الأمان" });
  }
};

// POST /api/auth/password - keeps this session (new token), ends every other one.
export const changeMyPassword = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    const result = await changeOwnPassword({
      req,
      row,
      currentPassword: req.body?.current_password,
      newPassword: req.body?.new_password,
    });
    if (!result.ok) return stepError(res, result);
    return res.json({ success: true, token: await sessionTokenFor(row.id), message: "تم تغيير كلمة المرور" });
  } catch (error) {
    console.error("[auth] password change failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر تغيير كلمة المرور" });
  }
};

// POST /api/auth/mfa/enroll/start
export const startMyMfaEnrollment = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    if (row.mfa_enabled === true) {
      return res.status(409).json({ success: false, code: "MFA_ALREADY_ENABLED", message: "التحقق الثنائي مفعّل بالفعل" });
    }
    return res.json({ success: true, ...(await startMfaEnrollment(row)) });
  } catch (error) {
    console.error("[auth] MFA enrolment start failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر بدء التفعيل" });
  }
};

// POST /api/auth/mfa/enroll/confirm
export const confirmMyMfaEnrollment = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    if (row.mfa_enabled === true) {
      return res.status(409).json({ success: false, code: "MFA_ALREADY_ENABLED", message: "التحقق الثنائي مفعّل بالفعل" });
    }
    const result = await confirmMfaEnrollment({ req, row, code: req.body?.code });
    if (!result.ok) return stepError(res, result);
    return res.json({ success: true, recovery_codes: result.recoveryCodes, token: await sessionTokenFor(row.id) });
  } catch (error) {
    console.error("[auth] MFA enrolment confirm failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر تأكيد التفعيل" });
  }
};

const verifyPasswordAndCode = async (req, row) => {
  if (!row?.password || !(await bcrypt.compare(String(req.body?.password || ""), row.password))) {
    await recordSecurityEvent({ req, eventType: "mfa_sensitive_action", outcome: "failure", userId: row?.id, tenantId: row?.tenant_id, details: { reason_code: "password_wrong" } });
    return { ok: false, status: 400, code: "CURRENT_PASSWORD_WRONG", message: "كلمة المرور غير صحيحة" };
  }
  return verifyMfaForLogin({ req, row, code: req.body?.code });
};

// POST /api/auth/mfa/disable - needs the password AND a current code; refused while MFA is required.
export const disableMyMfa = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    const policy = await getStaffSecurityPolicy();
    const permissions = await getUserPermissions(row.id, row.tenant_id);
    if (policy.mfaRequired && userRequiresMfa(row, permissions)) {
      return res.status(403).json({ success: false, code: "MFA_REQUIRED", message: "التحقق الثنائي إلزامي لحسابك ولا يمكن إيقافه" });
    }
    const check = await verifyPasswordAndCode(req, row);
    if (!check.ok) return stepError(res, check);
    await clearMfa({ req, targetRow: row, actorUserId: row.id, eventType: "mfa_disabled" });
    return res.json({ success: true, token: await sessionTokenFor(row.id) });
  } catch (error) {
    console.error("[auth] MFA disable failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر إيقاف التحقق الثنائي" });
  }
};

// POST /api/auth/mfa/recovery-codes
export const regenerateMyRecoveryCodes = async (req, res) => {
  try {
    const row = await loadStaffSecurityRow(req.user.id);
    const check = await verifyPasswordAndCode(req, row);
    if (!check.ok) return stepError(res, check);
    return res.json({ success: true, recovery_codes: await regenerateRecoveryCodes({ req, row }) });
  } catch (error) {
    console.error("[auth] recovery code regeneration failed", { message: error?.message || String(error) });
    return res.status(500).json({ success: false, message: "تعذر إنشاء أكواد جديدة" });
  }
};

export const me = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const current = await db.query(
      `
      SELECT
        u.*,
        r.name AS role_name,
        u.is_super_admin
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User Not Found",
      });
    }

    const permissions = await getUserPermissions(userId);
    const tenantBranding = current.rows[0]?.tenant_id
      ? await db.query(
          `
          SELECT
            t.id,
            t.slug,
            COALESCE(NULLIF(TRIM(t.company_name), ''), NULLIF(TRIM(c.company_name), ''), NULLIF(TRIM(t.name), ''), 'MONE') AS company_name,
            COALESCE(NULLIF(TRIM(t.company_logo_url), ''), NULLIF(TRIM(c.logo_url), ''), '') AS company_logo_url,
            COALESCE(NULLIF(TRIM(t.favicon_url), ''), NULLIF(TRIM(c.favicon_url), ''), '') AS favicon_url
          FROM tenants t
          LEFT JOIN company_profiles c ON c.tenant_id = t.id
          WHERE t.id = $1
          LIMIT 1
          `,
          [current.rows[0].tenant_id]
        ).catch(() => ({ rows: [] }))
      : { rows: [] };
    const tenant = tenantBranding.rows[0]
      ? {
          id: tenantBranding.rows[0].id,
          slug: tenantBranding.rows[0].slug,
          name: tenantBranding.rows[0].company_name,
          companyName: tenantBranding.rows[0].company_name,
          company_logo_url: tenantBranding.rows[0].company_logo_url || "",
          companyLogoUrl: tenantBranding.rows[0].company_logo_url || "",
          favicon_url: tenantBranding.rows[0].favicon_url || "",
          faviconUrl: tenantBranding.rows[0].favicon_url || "",
        }
      : null;

    const currentUser = stripSensitiveUserFields(current.rows[0]);
    const reviewerAccount = isMetaReviewerRole(currentUser?.role || currentUser?.role_name);
    const safeReviewerUser = reviewerAccount
      ? {
          id: currentUser.id,
          tenant_id: currentUser.tenant_id,
          name: currentUser.name,
          email: currentUser.email,
          role: "admin",
          role_name: "admin",
          account_mode: "meta_reviewer",
          is_active: currentUser.is_active,
          is_super_admin: false,
          account_expires_at: currentUser.account_expires_at,
        }
      : currentUser;
    return res.json({
      success: true,
      user: {
        ...safeReviewerUser,
        company_name: tenant?.companyName || current.rows[0]?.company_name || "",
        company_logo_url: tenant?.companyLogoUrl || current.rows[0]?.company_logo_url || "",
        favicon_url: tenant?.faviconUrl || current.rows[0]?.favicon_url || "",
        permissions,
      },
      tenant,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed To Fetch Profile",
      error: error.message,
    });
  }
};
