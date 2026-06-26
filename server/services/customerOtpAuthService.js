import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import db from "../database/db.js";
import { normalizePhone as normalizeInputPhone } from "../utils/phoneSearch.js";
import { normalizeEgyptianMobile } from "./storefrontCustomerSessionService.js";
import { normalizeEgyptPhone } from "./whatsappGatewayService.js";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

const text = (value = "") => String(value ?? "").trim();

const otpSecret = () =>
  String(process.env.JWT_SECRET || process.env.SECRET_ENCRYPTION_KEY || process.env.SECRET_KEY || "SECRET_KEY");

const hmacOtp = ({ tenantId = 0, phone = "", otp = "" } = {}) =>
  crypto.createHmac("sha256", otpSecret()).update(`${Number(tenantId) || 0}:${text(phone)}:${text(otp)}`).digest("hex");

const safeEqual = (left = "", right = "") => {
  const a = Buffer.from(text(left));
  const b = Buffer.from(text(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const randomOtp = () => String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");

const normalizeOtpPhone = (phone = "") => {
  const normalized = normalizeEgyptianMobile(normalizeInputPhone(phone));
  if (!normalized) return "";
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return "";
  if (!/^01[0125]\d{8}$/.test(digits) && !/^201[0125]\d{8}$/.test(digits)) return "";
  return digits.startsWith("20") ? `0${digits.slice(2)}` : digits;
};

const otpLog = (event, payload = {}) => {
  console.log(`[customer-otp] ${event}`, payload);
};

const ensureCustomerOtpAuthSchema = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_otps (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      phone TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts_count INTEGER NOT NULL DEFAULT 0,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.query(`ALTER TABLE IF EXISTS customer_otps ADD COLUMN IF NOT EXISTS attempts_count INTEGER NOT NULL DEFAULT 0`);
  await db.query(`ALTER TABLE IF EXISTS customer_otps ADD COLUMN IF NOT EXISTS used BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(`ALTER TABLE IF EXISTS customer_otps ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_otps_tenant_phone ON customer_otps (tenant_id, phone)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_customer_otps_expires_at ON customer_otps (expires_at)`);
};

const evolutionConfig = () => {
  const apiUrl = String(process.env.EVOLUTION_API_URL || "").trim().replace(/\/+$/g, "");
  const apiKey = String(process.env.EVOLUTION_API_KEY || "").trim();
  const instanceName = String(process.env.WHATSAPP_INSTANCE_NAME || process.env.EVOLUTION_INSTANCE_NAME || "m1-store").trim();
  return { apiUrl, apiKey, instanceName };
};

export const sendCustomerOtpWhatsApp = async (phone = "", otp = "") => {
  const normalizedPhone = normalizeEgyptPhone(phone);
  if (!normalizedPhone) {
    const error = new Error("WhatsApp recipient phone is required");
    error.status = 400;
    error.code = "CUSTOMER_OTP_PHONE_REQUIRED";
    throw error;
  }
  const { apiUrl, apiKey, instanceName } = evolutionConfig();
  if (!apiUrl || !apiKey || !instanceName) {
    const error = new Error("WhatsApp gateway is not configured");
    error.status = 409;
    error.code = "WHATSAPP_GATEWAY_NOT_CONFIGURED";
    throw error;
  }

  const message = `كود الدخول الخاص بك في M1 Store هو: ${text(otp)}\nصالح لمدة 5 دقائق.`;
  const url = `${apiUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
  otpLog("send-whatsapp", {
    phone_suffix: normalizedPhone.slice(-4),
    phone_length: normalizedPhone.length,
    instance_name: instanceName,
    transport: "evolution",
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number: normalizedPhone, text: message }),
  });
  const raw = await response.text();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `Evolution API returned ${response.status}`);
    error.status = response.status;
    error.code = "CUSTOMER_OTP_WHATSAPP_SEND_FAILED";
    error.data = payload;
    throw error;
  }
  return { success: true, phone: normalizedPhone, result: payload };
};

export const requestCustomerOtp = async ({ tenantId = null, phone = "" } = {}) => {
  await ensureCustomerOtpAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const normalizedPhone = normalizeOtpPhone(phone);
  if (!safeTenantId || !normalizedPhone) {
    const error = new Error("INVALID_PHONE");
    error.status = 400;
    error.code = "CUSTOMER_OTP_INVALID_PHONE";
    throw error;
  }
  otpLog("request", {
    tenant_id: safeTenantId,
    phone_suffix: normalizedPhone.slice(-4),
    phone_length: normalizedPhone.length,
    cooldown_seconds: 60,
    expires_in_seconds: 300,
  });

  const client = await db.connect();
  let createdOtp = "";
  let otpRowId = null;
  try {
    await client.query("BEGIN");
    const recent = await client.query(
      `
      SELECT id, created_at
      FROM customer_otps
      WHERE tenant_id = $1::integer
        AND phone = $2::text
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [safeTenantId, normalizedPhone]
    );
    const lastRow = recent.rows?.[0] || null;
    if (lastRow?.created_at) {
      const ageMs = Date.now() - new Date(lastRow.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < OTP_RESEND_COOLDOWN_MS) {
        await client.query("ROLLBACK");
        return {
          success: false,
          cooldown: true,
          retry_after_seconds: Math.max(1, Math.ceil((OTP_RESEND_COOLDOWN_MS - ageMs) / 1000)),
        };
      }
    }

    createdOtp = randomOtp();
    const otpHash = hmacOtp({ tenantId: safeTenantId, phone: normalizedPhone, otp: createdOtp });
    const insertResult = await client.query(
      `
      INSERT INTO customer_otps (tenant_id, phone, otp_hash, expires_at, attempts_count, used)
      VALUES ($1::integer, $2::text, $3::text, NOW() + INTERVAL '5 minutes', 0, FALSE)
      RETURNING id, expires_at, created_at
      `,
      [safeTenantId, normalizedPhone, otpHash]
    );
    otpRowId = insertResult.rows?.[0]?.id || null;
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    try {
      client.release();
    } catch {}
  }

  try {
    await sendCustomerOtpWhatsApp(normalizedPhone, createdOtp);
    otpLog("request", {
      tenant_id: safeTenantId,
      phone_suffix: normalizedPhone.slice(-4),
      phone_length: normalizedPhone.length,
      cooldown_seconds: 60,
      expires_in_seconds: 300,
      row_id: otpRowId,
      sent: true,
    });
    return {
      success: true,
      sent: true,
      expires_in_seconds: 300,
      cooldown_seconds: 60,
    };
  } catch (error) {
    if (otpRowId) {
      await db.query(`DELETE FROM customer_otps WHERE id = $1::int`, [otpRowId]).catch(() => {});
    }
    otpLog("request", {
      tenant_id: safeTenantId,
      phone_suffix: normalizedPhone.slice(-4),
      phone_length: normalizedPhone.length,
      sent: false,
      error: error?.message || String(error),
    });
    throw error;
  }
};

export const verifyCustomerOtp = async ({ tenantId = null, phone = "", otp = "" } = {}) => {
  await ensureCustomerOtpAuthSchema();
  const safeTenantId = Number(tenantId) || 0;
  const normalizedPhone = normalizeOtpPhone(phone);
  const safeOtp = String(otp || "").trim();
  if (!safeTenantId || !normalizedPhone || !/^\d{6}$/.test(safeOtp)) {
    otpLog("verify-failed", {
      tenant_id: safeTenantId || null,
      phone_suffix: normalizedPhone.slice(-4),
      reason: "invalid_payload",
    });
    return { success: false };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `
      SELECT *
      FROM customer_otps
      WHERE tenant_id = $1::integer
        AND phone = $2::text
      ORDER BY created_at DESC, id DESC
      LIMIT 1
      FOR UPDATE
      `,
      [safeTenantId, normalizedPhone]
    );
    const row = result.rows?.[0] || null;
    const now = new Date();
    if (!row || row.used || new Date(row.expires_at) <= now || Number(row.attempts_count || 0) >= OTP_MAX_ATTEMPTS) {
      if (row?.id) {
        await client.query(
          `
          UPDATE customer_otps
          SET used = TRUE
          WHERE id = $1::int
          `,
          [row.id]
        ).catch(() => {});
      }
      await client.query("COMMIT");
      otpLog("verify-failed", {
        tenant_id: safeTenantId,
        phone_suffix: normalizedPhone.slice(-4),
        reason: "expired_or_invalid",
      });
      return { success: false };
    }

    const expectedHash = hmacOtp({ tenantId: safeTenantId, phone: normalizedPhone, otp: safeOtp });
    const isValid = safeEqual(expectedHash, row.otp_hash);
    if (!isValid) {
      const nextAttempts = Number(row.attempts_count || 0) + 1;
      await client.query(
        `
        UPDATE customer_otps
        SET attempts_count = $2::int,
            used = CASE WHEN $2::int >= $3::int THEN TRUE ELSE used END
        WHERE id = $1::int
        `,
        [row.id, nextAttempts, OTP_MAX_ATTEMPTS]
      );
      await client.query("COMMIT");
      otpLog("verify-failed", {
        tenant_id: safeTenantId,
        phone_suffix: normalizedPhone.slice(-4),
        attempts: nextAttempts,
      });
      return { success: false };
    }

    await client.query(
      `
      UPDATE customer_otps
      SET used = TRUE,
          attempts_count = attempts_count + 1
      WHERE id = $1::int
      `,
      [row.id]
    );
    await client.query("COMMIT");

    const token = jwt.sign(
      {
        type: "storefront_customer",
        tenant_id: safeTenantId,
        phone: normalizedPhone,
      },
      process.env.JWT_SECRET || "SECRET_KEY",
      { expiresIn: "30d" }
    );
    otpLog("verify-success", {
      tenant_id: safeTenantId,
      phone_suffix: normalizedPhone.slice(-4),
    });
    return {
      success: true,
      token,
      customer: { phone: normalizedPhone },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    otpLog("verify-failed", {
      tenant_id: safeTenantId,
      phone_suffix: normalizedPhone.slice(-4),
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    try {
      client.release();
    } catch {}
  }
};

export { ensureCustomerOtpAuthSchema, normalizeOtpPhone as normalizePhone };
