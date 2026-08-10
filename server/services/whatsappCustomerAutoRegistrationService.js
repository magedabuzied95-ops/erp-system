import db from "../database/db.js";

const text = (value = "") => String(value ?? "").trim();

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

export const autoRegisterWhatsappCustomer = async ({ tenantId, phone, whatsappName } = {}) => {
  const safeTenantId = Number(tenantId);
  const phoneVariants = getWhatsappCustomerPhoneVariants(phone);
  const normalizedPhone = phoneVariants.find((item) => item.startsWith("20") && item.length === 12) || phoneVariants[0] || "";
  const safeName = normalizeWhatsappCustomerName(whatsappName, normalizedPhone);
  if (!Number.isInteger(safeTenantId) || safeTenantId <= 0 || !normalizedPhone || !safeName) {
    return { created: false, updated: false, skipped: true, reason: !safeName ? "whatsapp_name_missing" : "customer_identity_missing" };
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))", [safeTenantId, normalizedPhone]);

    const existingResult = await client.query(
      `
      SELECT id, name, phone
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
      if (text(existing.name)) {
        await client.query("COMMIT");
        return { customerId: Number(existing.id), created: false, updated: false, preservedExistingName: true };
      }
      const updated = await client.query(
        `
        UPDATE customers
        SET name = $1, updated_at = NOW()
        WHERE id = $2
          AND tenant_id = $3
          AND NULLIF(TRIM(COALESCE(name, '')), '') IS NULL
        RETURNING id, name, phone
        `,
        [safeName, existing.id, safeTenantId]
      );
      await client.query("COMMIT");
      return {
        customerId: Number(existing.id),
        created: false,
        updated: updated.rowCount > 0,
        customer: updated.rows[0] || existing,
      };
    }

    const inserted = await client.query(
      `
      INSERT INTO customers (tenant_id, name, phone, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'active', NOW(), NOW())
      RETURNING id, name, phone
      `,
      [safeTenantId, safeName, normalizedPhone]
    );
    await client.query("COMMIT");
    return {
      customerId: Number(inserted.rows[0]?.id),
      created: true,
      updated: false,
      customer: inserted.rows[0] || null,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

