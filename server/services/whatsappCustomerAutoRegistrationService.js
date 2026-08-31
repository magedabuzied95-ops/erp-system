import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();

// The webhook can register a customer long before any /customers request has run
// ensureCustomerSchema, so the avatar columns are ensured here too. One promise
// per process keeps it off the per-message path.
let avatarSchemaPromise = null;
const ensureCustomerAvatarSchema = async () => {
  if (!avatarSchemaPromise) {
    avatarSchemaPromise = (async () => {
      await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT`);
      await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_source VARCHAR(40)`);
      await db.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMPTZ NULL`);
    })().catch((error) => {
      avatarSchemaPromise = null;
      throw error;
    });
  }
  return avatarSchemaPromise;
};

export const ensureWhatsappCustomerAvatarSchema = ensureCustomerAvatarSchema;

const normalizeAvatarUrl = (value = "") => {
  const url = text(value);
  return /^https?:\/\//i.test(url) ? url.slice(0, 2048) : "";
};

export const normalizeWhatsappCustomerName = (value = "", phone = "") => {
  const name = text(value).replace(/\s+/g, " ").slice(0, 255);
  if (!name) return "";

  const normalizedNameDigits = name.replace(/\D/g, "");
  const normalizedPhoneDigits = text(phone).replace(/\D/g, "");
  if (normalizedNameDigits && normalizedNameDigits === normalizedPhoneDigits) return "";

  const lower = name.toLowerCase();
  if (["unknown", "undefined", "null", "default", "whatsapp", "بدون اسم", "غير معروف"].includes(lower)) return "";
  return name;
};

export const getWhatsappCustomerPhoneVariants = (value = "") => {
  let digits = text(value).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!digits) return [];

  const variants = new Set([digits]);
  if (digits.startsWith("20") && digits.length === 12) variants.add(`0${digits.slice(2)}`);
  if (digits.startsWith("0") && digits.length === 11) variants.add(`2${digits}`);
  return Array.from(variants);
};

export const autoRegisterWhatsappCustomer = async ({ tenantId, phone, whatsappName, avatarUrl = "", avatarSource = "whatsapp" } = {}) => {
  const safeTenantId = Number(tenantId);
  const phoneVariants = getWhatsappCustomerPhoneVariants(phone);
  const normalizedPhone = phoneVariants.find((item) => item.startsWith("20") && item.length === 12) || phoneVariants[0] || "";
  const safeName = normalizeWhatsappCustomerName(whatsappName, normalizedPhone);
  const safeAvatarUrl = normalizeAvatarUrl(avatarUrl);
  const safeAvatarSource = text(avatarSource).slice(0, 40) || "whatsapp";
  if (!Number.isInteger(safeTenantId) || safeTenantId <= 0 || !normalizedPhone) {
    return { created: false, updated: false, skipped: true, reason: "customer_identity_missing" };
  }
  // A nameless sender still can't mint a new record, but their picture is worth
  // attaching to the record that already exists.
  if (!safeName && !safeAvatarUrl) {
    return { created: false, updated: false, skipped: true, reason: "whatsapp_name_missing" };
  }

  await ensureCustomerAvatarSchema();

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))", [safeTenantId, normalizedPhone]);

    const existingResult = await client.query(
      `
      SELECT id, name, phone, avatar_url
      FROM customers
      WHERE tenant_id = $1
        AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = ANY($2::text[])
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
      `,
      [safeTenantId, phoneVariants]
    );
    const existing = existingResult.rows[0] || null;

    if (existing) {
      // WhatsApp re-issues a picture URL whenever the customer changes their
      // photo, so a differing url is a refresh, not a duplicate write.
      const avatarChanged = Boolean(safeAvatarUrl) && safeAvatarUrl !== text(existing.avatar_url);
      const nameMissing = !text(existing.name);
      if (!avatarChanged && !nameMissing) {
        await client.query("COMMIT");
        return { customerId: Number(existing.id), created: false, updated: false, avatarUpdated: false, preservedExistingName: true };
      }
      const updated = await client.query(
        `
        UPDATE customers
        SET
          name = CASE WHEN NULLIF(TRIM(COALESCE(name, '')), '') IS NULL AND $1::text <> '' THEN $1::text ELSE name END,
          avatar_url = CASE WHEN $4::text <> '' THEN $4::text ELSE avatar_url END,
          avatar_source = CASE WHEN $4::text <> '' THEN $5::text ELSE avatar_source END,
          avatar_updated_at = CASE WHEN $4::text <> '' THEN NOW() ELSE avatar_updated_at END,
          updated_at = NOW()
        WHERE id = $2
          AND tenant_id = $3
        RETURNING id, name, phone, avatar_url
        `,
        [safeName, existing.id, safeTenantId, safeAvatarUrl, safeAvatarSource]
      );
      await client.query("COMMIT");
      const customer = updated.rows[0] || existing;
      return {
        customerId: Number(existing.id),
        created: false,
        updated: nameMissing && Boolean(safeName) && text(customer.name) !== text(existing.name),
        avatarUpdated: avatarChanged,
        customer,
      };
    }

    if (!safeName) {
      await client.query("COMMIT");
      return { created: false, updated: false, skipped: true, reason: "whatsapp_name_missing" };
    }

    const inserted = await client.query(
      `
      INSERT INTO customers (tenant_id, name, phone, status, avatar_url, avatar_source, avatar_updated_at, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', NULLIF($4::text, ''), CASE WHEN $4::text <> '' THEN $5::text ELSE NULL END, CASE WHEN $4::text <> '' THEN NOW() ELSE NULL END, NOW(), NOW())
      RETURNING id, name, phone, avatar_url
      `,
      [safeTenantId, safeName, normalizedPhone, safeAvatarUrl, safeAvatarSource]
    );
    await client.query("COMMIT");
    return {
      customerId: Number(inserted.rows[0]?.id),
      created: true,
      updated: false,
      avatarUpdated: Boolean(safeAvatarUrl),
      customer: inserted.rows[0] || null,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

