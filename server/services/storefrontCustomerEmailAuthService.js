import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { getPublicAppUrl } from "../utils/publicUrl.js";
import { getPhoneSearchVariants, normalizePhone, phoneSqlDigits } from "../utils/phoneSearch.js";
import { normalizeEgyptianMobile } from "./storefrontCustomerSessionService.js";
import { sendSmtpMail } from "./staffTaskEmailNotificationService.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 8;
const STOREFRONT_CUSTOMER_AUTH_TTL = String(process.env.STOREFRONT_CUSTOMER_AUTH_TTL || "730d").trim() || "730d";

const text = (value = "") => String(value ?? "").trim();
const normalizeEmail = (value = "") => text(value).toLowerCase();
const safeEmailDomain = (value = "") => {
  const email = normalizeEmail(value);
  const atIndex = email.lastIndexOf("@");
  return atIndex > -1 ? email.slice(atIndex + 1) : "";
};
const hashToken = (value = "") => crypto.createHash("sha256").update(text(value)).digest("hex");

const logEvent = (event, payload = {}) => {
  console.info(`[storefront-customer-email-auth] ${event}`, payload);
};

const ensureCustomerEmailAuthSchema = async () => {
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_hash TEXT`);
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_token_expires_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ NULL`);
  await db.query(`ALTER TABLE IF EXISTS customers ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL`);
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_customers_tenant_email_lower
    ON customers (tenant_id, LOWER(email))
    WHERE email IS NOT NULL AND email <> ''
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customers_password_reset_token_hash ON customers (password_reset_token_hash)`);
};

const buildEmailAlreadyExistsError = () => {
  const error = new Error("EMAIL_ALREADY_EXISTS");
  error.status = 409;
  error.code = "EMAIL_ALREADY_EXISTS";
  error.message = "هذا البريد الإلكتروني مسجل بالفعل داخل نفس الحساب";
  return error;
};

const isUniqueEmailConflictError = (error = {}) => {
  const code = String(error?.code || "");
  const constraint = String(error?.constraint || "");
  const message = String(error?.message || "");
  return (
    code === "23505" &&
    (
      constraint === "ux_customers_tenant_email_lower" ||
      message.includes("ux_customers_tenant_email_lower") ||
      message.includes("duplicate key value")
    )
  );
};

const normalizeRegisterPhone = (value = "") => {
  const normalized = normalizeEgyptianMobile(normalizePhone(value));
  return normalized ? normalized.replace(/\D/g, "") : "";
};

const buildCustomerAuthToken = (customer = {}, authMethod = "email_password") =>
  jwt.sign(
    {
      type: "storefront_customer",
      tenant_id: customer.tenant_id ?? null,
      customer_id: customer.id ?? null,
      phone: text(customer.phone || ""),
      email: normalizeEmail(customer.email || ""),
      auth_method: authMethod,
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: STOREFRONT_CUSTOMER_AUTH_TTL }
  );

const resolveCustomerByEmail = async (clientOrPool, { tenantId, email }) => {
  const normalizedEmail = normalizeEmail(email);
  if (!tenantId || !normalizedEmail) return null;
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM customers
    WHERE tenant_id = $1
      AND LOWER(COALESCE(email, '')) = $2
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [tenantId, normalizedEmail]
  );
  return result.rows[0] || null;
};

const resolveCustomerByPhone = async (clientOrPool, { tenantId, phone }) => {
  const normalizedPhone = normalizeRegisterPhone(phone);
  if (!tenantId || !normalizedPhone) return null;
  const variants = getPhoneSearchVariants(normalizedPhone);
  if (!variants.length) return null;
  const result = await clientOrPool.query(
    `
    SELECT *
    FROM customers
    WHERE tenant_id = $1
      AND ${phoneSqlDigits("phone")} = ANY($2::text[])
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [tenantId, variants]
  );
  return result.rows[0] || null;
};

const persistCustomerPassword = async (client, { customerId, passwordHash, email, phone, name }) => {
  const result = await client.query(
    `
    UPDATE customers
    SET name = COALESCE(NULLIF($3, ''), name),
        email = COALESCE(NULLIF($4, ''), email),
        phone = COALESCE(NULLIF(phone, ''), NULLIF($5, ''), phone),
        password_hash = $2,
        password_changed_at = CURRENT_TIMESTAMP,
        email_verified_at = COALESCE(email_verified_at, CURRENT_TIMESTAMP),
        password_reset_token_hash = NULL,
        password_reset_token_expires_at = NULL,
        password_reset_requested_at = NULL,
        registration_source = COALESCE(NULLIF(registration_source, ''), 'storefront_email'),
        is_storefront_customer = TRUE,
        status = 'active',
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    RETURNING *
    `,
    [customerId, passwordHash, text(name).slice(0, 255), normalizeEmail(email), normalizeRegisterPhone(phone)]
  );
  return result.rows[0] || null;
};

const insertCustomerWithPassword = async (client, { tenantId, name, email, phone, passwordHash }) => {
  const result = await client.query(
    `
    INSERT INTO customers (
      tenant_id,
      name,
      phone,
      email,
      password_hash,
      password_changed_at,
      email_verified_at,
      status,
      registration_source,
      created_at,
      updated_at,
      first_visit_at,
      last_visit_at,
      storefront_last_seen_at,
      is_storefront_customer
    )
    VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'active','storefront_email',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,TRUE)
    RETURNING *
    `,
    [tenantId, text(name).slice(0, 255), normalizeRegisterPhone(phone), normalizeEmail(email), passwordHash]
  );
  return result.rows[0] || null;
};

const buildEmailConflictError = () => {
  const error = new Error("EMAIL_ALREADY_EXISTS");
  error.status = 409;
  error.code = "EMAIL_ALREADY_EXISTS";
  error.message = "هذا البريد الإلكتروني مرتبط بحساب آخر.";
  return error;
};

const prepareAuthCustomer = (customer = {}) => ({
  id: customer.id || null,
  tenant_id: customer.tenant_id ?? null,
  name: customer.name || "",
  email: normalizeEmail(customer.email || ""),
  phone: normalizeRegisterPhone(customer.phone || ""),
});

const ensureResetLinkBase = () => {
  const baseUrl = text(getPublicAppUrl() || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_URL || "");
  if (!baseUrl) return "";
  return baseUrl.replace(/\/+$/, "");
};

const buildPasswordResetLink = (token) => {
  const resetPath = `/account/reset-password?token=${encodeURIComponent(token)}`;
  const baseUrl = ensureResetLinkBase();
  return baseUrl ? `${baseUrl}${resetPath}` : resetPath;
};

export const registerStorefrontCustomerEmailAuth = async ({ tenantId = null, name = "", email = "", phone = "", password = "" } = {}) => {
  await ensureCustomerEmailAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const safeName = text(name).slice(0, 255);
  const safeEmail = normalizeEmail(email);
  const safePhone = normalizeRegisterPhone(phone);
  const safePassword = String(password || "");

  if (!safeTenantId || !safeName || !safeEmail || !safePhone || safePassword.length < PASSWORD_MIN_LENGTH) {
    const error = new Error("INVALID_EMAIL_AUTH_REGISTER_PAYLOAD");
    error.status = 400;
    error.code = "INVALID_EMAIL_AUTH_REGISTER_PAYLOAD";
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const phoneCustomer = await resolveCustomerByPhone(client, { tenantId: safeTenantId, phone: safePhone });
    const emailCustomer = await resolveCustomerByEmail(client, { tenantId: safeTenantId, email: safeEmail });

    if (emailCustomer && phoneCustomer && emailCustomer.id !== phoneCustomer.id) {
      await client.query("ROLLBACK");
      const error = buildEmailConflictError();
      logEvent("CUSTOMER_EMAIL_AUTH_REGISTER_EMAIL_CONFLICT", {
        tenant_id: safeTenantId,
        phone_suffix: safePhone ? safePhone.slice(-4) : "",
        email_domain: safeEmailDomain(safeEmail),
      });
      throw error;
    }

    if (!phoneCustomer && emailCustomer) {
      await client.query("ROLLBACK");
      const error = buildEmailConflictError();
      logEvent("CUSTOMER_EMAIL_AUTH_REGISTER_EMAIL_CONFLICT", {
        tenant_id: safeTenantId,
        phone_suffix: safePhone ? safePhone.slice(-4) : "",
        email_domain: safeEmailDomain(safeEmail),
      });
      throw error;
    }

    const passwordHash = await bcrypt.hash(safePassword, 10);
    let customer = null;
    if (phoneCustomer) {
      customer = await persistCustomerPassword(client, {
        customerId: phoneCustomer.id,
        passwordHash,
        email: safeEmail,
        phone: safePhone || phoneCustomer.phone || "",
        name: safeName || phoneCustomer.name || "",
      });
    } else {
      customer = await insertCustomerWithPassword(client, {
        tenantId: safeTenantId,
        name: safeName,
        email: safeEmail,
        phone: safePhone,
        passwordHash,
      });
    }

    await client.query("COMMIT");
    const authCustomer = prepareAuthCustomer(customer || {});
    const token = buildCustomerAuthToken(authCustomer, "email_password");
    if (phoneCustomer) {
      logEvent("CUSTOMER_EMAIL_AUTH_REGISTER_LINKED_BY_PHONE", {
        tenant_id: safeTenantId,
        customer_id: authCustomer.id,
        email_domain: safeEmailDomain(safeEmail),
        phone_suffix: authCustomer.phone ? authCustomer.phone.slice(-4) : "",
      });
    } else {
      logEvent("CUSTOMER_EMAIL_AUTH_REGISTER_CREATED", {
        tenant_id: safeTenantId,
        customer_id: authCustomer.id,
        email_domain: safeEmailDomain(safeEmail),
        phone_suffix: authCustomer.phone ? authCustomer.phone.slice(-4) : "",
      });
    }
    logEvent("CUSTOMER_EMAIL_AUTH_REGISTER", {
      tenant_id: safeTenantId,
      customer_id: authCustomer.id,
      email_domain: safeEmailDomain(safeEmail),
      phone_suffix: authCustomer.phone ? authCustomer.phone.slice(-4) : "",
      has_password: true,
    });
    return {
      success: true,
      token,
      customer: authCustomer,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Session cleanup is best-effort when the backing table is unavailable.
    }
    if (isUniqueEmailConflictError(error)) {
      const emailConflictError = buildEmailConflictError();
      logEvent("CUSTOMER_EMAIL_AUTH_REGISTER_EMAIL_CONFLICT", {
        tenant_id: safeTenantId,
        email_domain: safeEmailDomain(safeEmail),
        phone_suffix: safePhone ? safePhone.slice(-4) : "",
      });
      throw emailConflictError;
    }
    logEvent("CUSTOMER_EMAIL_AUTH_REGISTER", {
      tenant_id: safeTenantId,
      email_domain: safeEmailDomain(safeEmail),
      phone_suffix: safePhone ? safePhone.slice(-4) : "",
      success: false,
      error: error?.code || error?.message || String(error),
    });
    throw error;
  } finally {
    try {
      client.release();
    } catch {
      // Session cleanup is best-effort when the backing table is unavailable.
    }
  }
};

export const loginStorefrontCustomerEmailAuth = async ({ tenantId = null, email = "", password = "" } = {}) => {
  await ensureCustomerEmailAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const safeEmail = normalizeEmail(email);
  const safePassword = String(password || "");
  if (!safeTenantId || !safeEmail || !safePassword) {
    const error = new Error("INVALID_EMAIL_AUTH_LOGIN_PAYLOAD");
    error.status = 400;
    error.code = "INVALID_EMAIL_AUTH_LOGIN_PAYLOAD";
    throw error;
  }

  const customer = await resolveCustomerByEmail(db, { tenantId: safeTenantId, email: safeEmail });
  if (!customer || !customer.password_hash) {
    logEvent("CUSTOMER_EMAIL_AUTH_LOGIN", {
      tenant_id: safeTenantId,
      email_domain: safeEmailDomain(safeEmail),
      success: false,
      reason: "missing_customer_or_password",
    });
    const error = new Error("INVALID_EMAIL_OR_PASSWORD");
    error.status = 400;
    error.code = "INVALID_EMAIL_OR_PASSWORD";
    throw error;
  }

  const passwordMatches = await bcrypt.compare(safePassword, customer.password_hash);
  if (!passwordMatches) {
    logEvent("CUSTOMER_EMAIL_AUTH_LOGIN", {
      tenant_id: safeTenantId,
      customer_id: customer.id,
      email_domain: safeEmailDomain(safeEmail),
      success: false,
      reason: "password_mismatch",
    });
    const error = new Error("INVALID_EMAIL_OR_PASSWORD");
    error.status = 400;
    error.code = "INVALID_EMAIL_OR_PASSWORD";
    throw error;
  }

  if (customer.status && String(customer.status).toLowerCase() === "inactive") {
    const error = new Error("ACCOUNT_DISABLED");
    error.status = 403;
    error.code = "ACCOUNT_DISABLED";
    throw error;
  }

  await db.query(
    `
    UPDATE customers
    SET last_visit_at = CURRENT_TIMESTAMP,
        storefront_last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [customer.id]
  );

  const authCustomer = prepareAuthCustomer(customer);
  const token = buildCustomerAuthToken(authCustomer, "email_password");
  logEvent("CUSTOMER_EMAIL_AUTH_LOGIN", {
    tenant_id: safeTenantId,
    customer_id: authCustomer.id,
    email_domain: safeEmailDomain(safeEmail),
    phone_suffix: authCustomer.phone ? authCustomer.phone.slice(-4) : "",
    success: true,
  });
  return {
    success: true,
    token,
    customer: authCustomer,
  };
};

export const requestStorefrontCustomerPasswordReset = async ({ tenantId = null, email = "" } = {}) => {
  await ensureCustomerEmailAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const safeEmail = normalizeEmail(email);
  if (!safeTenantId || !safeEmail) {
    const error = new Error("INVALID_PASSWORD_RESET_REQUEST");
    error.status = 400;
    error.code = "INVALID_PASSWORD_RESET_REQUEST";
    throw error;
  }

  const customer = await resolveCustomerByEmail(db, { tenantId: safeTenantId, email: safeEmail });
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const resetUrl = buildPasswordResetLink(token);

  if (customer?.id) {
    await db.query(
      `
      UPDATE customers
      SET password_reset_token_hash = $2,
          password_reset_token_expires_at = $3,
          password_reset_requested_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      `,
      [customer.id, tokenHash, expiresAt]
    );
  }

  logEvent("CUSTOMER_PASSWORD_RESET_REQUESTED", {
    tenant_id: safeTenantId,
    customer_id: customer?.id || null,
    email_domain: safeEmailDomain(safeEmail),
    customer_found: Boolean(customer),
  });

  if (customer?.email) {
    await sendSmtpMail({
      to: customer.email,
      subject: "إعادة تعيين كلمة المرور",
      body: [
        `مرحبًا ${customer.name || ""}`,
        "",
        "وصلنا طلبًا لإعادة تعيين كلمة مرور حسابك في متجرنا.",
        "",
        "اضغط الرابط التالي لإكمال التعيين:",
        resetUrl,
        "",
        "هذا الرابط صالح لمدة 60 دقيقة فقط.",
        "",
        "إذا لم تطلب ذلك، تجاهل هذه الرسالة.",
      ].join("\n"),
    });
  }

  return {
    success: true,
    sent: true,
  };
};

export const resetStorefrontCustomerPassword = async ({ tenantId = null, token = "", password = "" } = {}) => {
  await ensureCustomerEmailAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const safeToken = text(token);
  const safePassword = String(password || "");
  if (!safeTenantId || !safeToken || safePassword.length < PASSWORD_MIN_LENGTH) {
    const error = new Error("INVALID_PASSWORD_RESET_PAYLOAD");
    error.status = 400;
    error.code = "INVALID_PASSWORD_RESET_PAYLOAD";
    throw error;
  }

  const tokenHash = hashToken(safeToken);
  const result = await db.query(
    `
    SELECT id, name, email, phone
    FROM customers
    WHERE tenant_id = $1
      AND password_reset_token_hash = $2
      AND password_reset_token_expires_at > CURRENT_TIMESTAMP
    ORDER BY password_reset_requested_at DESC NULLS LAST, updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [safeTenantId, tokenHash]
  );
  const customer = result.rows[0] || null;
  if (!customer?.id) {
    const error = new Error("INVALID_OR_EXPIRED_RESET_TOKEN");
    error.status = 400;
    error.code = "INVALID_OR_EXPIRED_RESET_TOKEN";
    throw error;
  }

  const passwordHash = await bcrypt.hash(safePassword, 10);
  await db.query(
    `
    UPDATE customers
    SET password_hash = $2,
        password_changed_at = CURRENT_TIMESTAMP,
        password_reset_token_hash = NULL,
        password_reset_token_expires_at = NULL,
        password_reset_requested_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
    `,
    [customer.id, passwordHash]
  );

  logEvent("CUSTOMER_PASSWORD_RESET_DONE", {
    tenant_id: safeTenantId,
    customer_id: customer.id,
    email_domain: safeEmailDomain(customer.email || ""),
  });

  return {
    success: true,
  };
};

export default {
  ensureCustomerEmailAuthSchema,
  loginStorefrontCustomerEmailAuth,
  registerStorefrontCustomerEmailAuth,
  requestStorefrontCustomerPasswordReset,
  resetStorefrontCustomerPassword,
};
