import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import db from "../database/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VALID_STATUSES = new Set(["active", "inactive"]);

const cleanText = (value) => String(value ?? "").trim();
const cleanOptional = (value) => {
  const text = cleanText(value);
  return text || null;
};
const normalizeEmail = (value) => cleanText(value).toLowerCase();
const normalizePhone = (value) => cleanText(value).replace(/[^\d+]/g, "");
const money = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const publicSupplier = (row = {}) => ({
  id: row.id,
  supplier_code: row.supplier_code || `SUP-${String(row.id || 0).padStart(4, "0")}`,
  name: row.name || "",
  phone: row.phone || "",
  whatsapp: row.whatsapp || "",
  email: row.email || "",
  address: row.address || "",
  tax_number: row.tax_number || "",
  contact_person: row.contact_person || "",
  opening_balance: Number(row.opening_balance || 0),
  current_balance: Number(row.current_balance ?? row.debt_balance ?? 0),
  debt_balance: Number(row.debt_balance ?? row.current_balance ?? 0),
  balance: Number(row.current_balance ?? row.debt_balance ?? 0),
  notes: row.notes || "",
  status: String(row.status || "active").toLowerCase(),
  total_purchases: Number(row.total_purchases || 0),
  purchase_count: Number(row.purchase_count || 0),
  last_purchase_date: row.last_purchase_date || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || row.created_at || null,
});

export const ensureSuppliersSchema = async (clientOrPool = db) => {
  const sqlPath = path.join(__dirname, "../database/suppliers_upgrade.sql");
  console.log("[migration] loading:", sqlPath);
  if (!fs.existsSync(sqlPath)) {
    console.warn("[migration] missing:", sqlPath);
    return;
  }
  const sql = await readFile(sqlPath, "utf8");
  await clientOrPool.query(sql);
};

const tenantClause = (tenantId, alias = "s", params = []) => {
  if (tenantId === null || tenantId === undefined) return "";
  params.push(tenantId);
  return ` AND (${alias}.tenant_id = $${params.length} OR ${alias}.tenant_id IS NULL)`;
};

const validateSupplierInput = (body = {}, { partial = false } = {}) => {
  const name = cleanText(body.name);
  if (!partial && !name) {
    const error = new Error("Supplier name is required");
    error.status = 400;
    throw error;
  }

  const email = normalizeEmail(body.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error("Invalid supplier email");
    error.status = 400;
    throw error;
  }

  const status = cleanText(body.status || "active").toLowerCase();
  if (!VALID_STATUSES.has(status)) {
    const error = new Error("Supplier status must be active or inactive");
    error.status = 400;
    throw error;
  }

  return {
    name,
    phone: cleanOptional(body.phone),
    whatsapp: cleanOptional(body.whatsapp),
    email: email || null,
    address: cleanOptional(body.address),
    tax_number: cleanOptional(body.tax_number),
    contact_person: cleanOptional(body.contact_person),
    opening_balance: money(body.opening_balance),
    current_balance: money(body.current_balance ?? body.opening_balance),
    notes: cleanOptional(body.notes),
    status,
  };
};

const assertNoDuplicateContact = async ({ client = db, tenantId = null, phone = "", email = "", excludeId = null }) => {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedPhone && !normalizedEmail) return;

  const params = [];
  const where = ["s.deleted_at IS NULL"];
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    where.push("(s.tenant_id = $1 OR s.tenant_id IS NULL)");
  }
  if (excludeId) {
    params.push(excludeId);
    where.push(`s.id <> $${params.length}`);
  }

  const contactChecks = [];
  if (normalizedPhone) {
    params.push(normalizedPhone.replace(/\D/g, ""));
    contactChecks.push(`regexp_replace(COALESCE(s.phone, ''), '\\D', '', 'g') = $${params.length}`);
    contactChecks.push(`regexp_replace(COALESCE(s.whatsapp, ''), '\\D', '', 'g') = $${params.length}`);
  }
  if (normalizedEmail) {
    params.push(normalizedEmail);
    contactChecks.push(`LOWER(COALESCE(s.email, '')) = $${params.length}`);
  }
  where.push(`(${contactChecks.join(" OR ")})`);

  const result = await client.query(`SELECT id, name FROM suppliers s WHERE ${where.join(" AND ")} LIMIT 1`, params);
  if (result.rows[0]) {
    const error = new Error("A supplier with the same phone, WhatsApp, or email already exists");
    error.status = 409;
    error.existing = publicSupplier(result.rows[0]);
    throw error;
  }
};

const nextSupplierCode = async (client) => {
  const result = await client.query(
    `
    SELECT COALESCE(MAX(NULLIF(regexp_replace(supplier_code, '\\D', '', 'g'), '')::int), 0) + 1 AS next_number
    FROM suppliers
    WHERE supplier_code LIKE 'SUP-%'
    `
  );
  return `SUP-${String(Number(result.rows[0]?.next_number || 1)).padStart(4, "0")}`;
};

export const listSuppliers = async ({ tenantId = null, page = 1, limit = 20, search = "", status = "all", sort = "newest" } = {}) => {
  await ensureSuppliersSchema();
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(500, Math.max(1, Number.parseInt(limit, 10) || 20));
  const params = [];
  const where = ["s.deleted_at IS NULL"];
  if (tenantId !== null && tenantId !== undefined) {
    params.push(tenantId);
    where.push("(s.tenant_id = $1 OR s.tenant_id IS NULL)");
  }
  const query = cleanText(search);
  if (query) {
    params.push(`%${query.toLowerCase()}%`);
    where.push(`(
      LOWER(COALESCE(s.name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.supplier_code, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.phone, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.whatsapp, '')) LIKE $${params.length}
      OR LOWER(COALESCE(s.email, '')) LIKE $${params.length}
    )`);
  }
  const safeStatus = cleanText(status).toLowerCase();
  if (VALID_STATUSES.has(safeStatus)) {
    params.push(safeStatus);
    where.push(`LOWER(COALESCE(s.status, 'active')) = $${params.length}`);
  }

  const orderBy = sort === "highest_balance"
    ? "s.current_balance DESC NULLS LAST, s.id DESC"
    : sort === "name"
      ? "LOWER(s.name) ASC, s.id DESC"
      : "s.created_at DESC, s.id DESC";

  const fromSql = `
    FROM suppliers s
    LEFT JOIN purchases p ON p.supplier_id = s.id
    WHERE ${where.join(" AND ")}
  `;

  const rows = await db.query(
    `
    SELECT
      s.*,
      COALESCE(SUM(COALESCE(p.total, 0)), 0) AS total_purchases,
      COUNT(p.id)::int AS purchase_count,
      MAX(p.created_at) AS last_purchase_date
    ${fromSql}
    GROUP BY s.id
    ORDER BY ${orderBy}
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, safeLimit, (safePage - 1) * safeLimit]
  );
  const total = await db.query(`SELECT COUNT(*)::int AS count FROM suppliers s WHERE ${where.join(" AND ")}`, params);
  const totalCount = Number(total.rows[0]?.count || 0);
  return {
    suppliers: rows.rows.map(publicSupplier),
    pagination: {
      total: totalCount,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
    },
  };
};

export const getSupplierById = async ({ tenantId = null, id }) => {
  await ensureSuppliersSchema();
  const params = [id];
  const scoped = tenantClause(tenantId, "s", params);
  const result = await db.query(
    `
    SELECT
      s.*,
      COALESCE(SUM(COALESCE(p.total, 0)), 0) AS total_purchases,
      COUNT(p.id)::int AS purchase_count,
      MAX(p.created_at) AS last_purchase_date
    FROM suppliers s
    LEFT JOIN purchases p ON p.supplier_id = s.id
    WHERE s.id = $1 AND s.deleted_at IS NULL ${scoped}
    GROUP BY s.id
    LIMIT 1
    `,
    params
  );
  const supplier = result.rows[0] ? publicSupplier(result.rows[0]) : null;
  if (!supplier) return null;

  const history = await db.query(
    `
    SELECT id, purchase_number, status, payment_status, COALESCE(total, 0) AS total, created_at
    FROM purchases
    WHERE supplier_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 12
    `,
    [id]
  );
  return {
    ...supplier,
    purchase_history: history.rows.map((row) => ({
      ...row,
      total: Number(row.total || 0),
    })),
  };
};

export const createSupplier = async ({ tenantId = null, body = {} }) => {
  await ensureSuppliersSchema();
  const supplier = validateSupplierInput(body);
  if (tenantId === null || tenantId === undefined) {
    const error = new Error("Tenant context is required");
    error.status = 400;
    throw error;
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertNoDuplicateContact({ client, tenantId, phone: supplier.phone || supplier.whatsapp, email: supplier.email });
    let created = null;
    for (let attempts = 0; attempts < 5 && !created; attempts += 1) {
      const supplierCode = await nextSupplierCode(client);
      try {
        const result = await client.query(
          `
          INSERT INTO suppliers (
            tenant_id, supplier_code, name, phone, whatsapp, email, address, tax_number,
            contact_person, opening_balance, current_balance, debt_balance, notes, status
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13)
          RETURNING *
          `,
          [
            tenantId,
            supplierCode,
            supplier.name,
            supplier.phone,
            supplier.whatsapp,
            supplier.email,
            supplier.address,
            supplier.tax_number,
            supplier.contact_person,
            supplier.opening_balance,
            supplier.current_balance,
            supplier.notes,
            supplier.status,
          ]
        );
        created = result.rows[0];
      } catch (error) {
        if (error?.code !== "23505") throw error;
      }
    }
    if (!created) {
      const error = new Error("Unable to generate a unique supplier code");
      error.status = 409;
      throw error;
    }
    await client.query("COMMIT");
    return publicSupplier(created);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const updateSupplier = async ({ tenantId = null, id, body = {} }) => {
  await ensureSuppliersSchema();
  const supplier = validateSupplierInput(body);
  await assertNoDuplicateContact({ tenantId, phone: supplier.phone || supplier.whatsapp, email: supplier.email, excludeId: id });
  const params = [
    supplier.name,
    supplier.phone,
    supplier.whatsapp,
    supplier.email,
    supplier.address,
    supplier.tax_number,
    supplier.contact_person,
    supplier.opening_balance,
    supplier.current_balance,
    supplier.notes,
    supplier.status,
    id,
  ];
  const scoped = tenantClause(tenantId, "suppliers", params);
  const result = await db.query(
    `
    UPDATE suppliers
    SET
      name = $1,
      phone = $2,
      whatsapp = $3,
      email = $4,
      address = $5,
      tax_number = $6,
      contact_person = $7,
      opening_balance = $8,
      current_balance = $9,
      debt_balance = $9,
      notes = $10,
      status = $11,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = $12 AND deleted_at IS NULL ${scoped}
    RETURNING *
    `,
    params
  );
  return result.rows[0] ? publicSupplier(result.rows[0]) : null;
};

export const deleteSupplier = async ({ tenantId = null, id }) => {
  await ensureSuppliersSchema();
  const params = [id];
  const scoped = tenantClause(tenantId, "suppliers", params);
  const result = await db.query(
    `
    UPDATE suppliers
    SET deleted_at = CURRENT_TIMESTAMP, status = 'inactive', updated_at = CURRENT_TIMESTAMP
    WHERE id = $1 AND deleted_at IS NULL ${scoped}
    RETURNING id
    `,
    params
  );
  return Boolean(result.rowCount);
};
