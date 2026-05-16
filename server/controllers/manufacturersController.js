import db from "../database/db.js";

const normalizeBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "active"].includes(String(value).toLowerCase());
};

const normalizeManufacturer = (row = {}) => ({
  id: row.id,
  name: row.name || "",
  contact_person: row.contact_person || "",
  contactPerson: row.contact_person || "",
  phone: row.phone || "",
  email: row.email || "",
  address: row.address || "",
  country: row.country || "",
  notes: row.notes || "",
  is_active: row.is_active ?? true,
  isActive: row.is_active ?? true,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null,
});

const ensureManufacturersTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS manufacturers (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      contact_person VARCHAR(255),
      phone VARCHAR(50),
      email VARCHAR(255),
      address TEXT,
      country VARCHAR(100),
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    ALTER TABLE manufacturers
      ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255),
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS country VARCHAR(100),
      ADD COLUMN IF NOT EXISTS notes TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  `);

};

const buildManufacturerPayload = (body = {}) => ({
  name: String(body.name || "").trim(),
  contact_person: String(body.contact_person ?? body.contactPerson ?? "").trim(),
  phone: String(body.phone || "").trim(),
  email: String(body.email || "").trim(),
  address: String(body.address || "").trim(),
  country: String(body.country || "").trim(),
  notes: String(body.notes || "").trim(),
  is_active: normalizeBoolean(body.is_active ?? body.isActive, true),
});

const isDuplicateNameError = (error) =>
  error?.code === "23505" &&
  String(error?.constraint || error?.message || "").toLowerCase().includes("manufacturer");

const findDuplicateByName = async (name, excludeId = null) => {
  const result = await db.query(
    `
    SELECT id
    FROM manufacturers
    WHERE LOWER(name) = LOWER($1)
      AND ($2::BIGINT IS NULL OR id <> $2::BIGINT)
    LIMIT 1
    `,
    [name, excludeId]
  );

  return result.rows[0] || null;
};

export const getManufacturers = async (req, res) => {
  try {
    await ensureManufacturersTable();

    const result = await db.query(
      `
      SELECT
        id,
        name,
        contact_person,
        phone,
        email,
        address,
        country,
        notes,
        is_active,
        created_at,
        updated_at
      FROM manufacturers
      ORDER BY name ASC, id DESC
      `
    );

    const manufacturers = result.rows.map(normalizeManufacturer);
    return res.json({
      success: true,
      data: manufacturers,
      manufacturers,
    });
  } catch (error) {
    console.error("[manufacturers] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch manufacturers",
      error: error.message,
    });
  }
};

export const createManufacturer = async (req, res) => {
  console.log("[manufacturers] request body:", req.body);

  try {
    await ensureManufacturersTable();

    const payload = buildManufacturerPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "Manufacturer name is required",
      });
    }

    const duplicate = await findDuplicateByName(payload.name);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "A manufacturer with this name already exists",
      });
    }

    const created = await db.query(
      `
      INSERT INTO manufacturers (
        name,
        contact_person,
        phone,
        email,
        address,
        country,
        notes,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING
        id,
        name,
        contact_person,
        phone,
        email,
        address,
        country,
        notes,
        is_active,
        created_at,
        updated_at
      `,
      [
        payload.name,
        payload.contact_person,
        payload.phone,
        payload.email,
        payload.address,
        payload.country,
        payload.notes,
        payload.is_active,
      ]
    );

    const manufacturer = normalizeManufacturer(created.rows[0]);
    return res.status(201).json({
      success: true,
      data: manufacturer,
      manufacturer,
    });
  } catch (error) {
    console.error("[manufacturers] error:", error);

    if (isDuplicateNameError(error)) {
      return res.status(409).json({
        success: false,
        message: "A manufacturer with this name already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create manufacturer",
      error: error.message,
    });
  }
};

export const updateManufacturer = async (req, res) => {
  console.log("[manufacturers] request body:", req.body);

  try {
    await ensureManufacturersTable();

    const payload = buildManufacturerPayload(req.body);
    if (!payload.name) {
      return res.status(400).json({
        success: false,
        message: "Manufacturer name is required",
      });
    }

    const duplicate = await findDuplicateByName(payload.name, req.params.id);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "A manufacturer with this name already exists",
      });
    }

    const updated = await db.query(
      `
      UPDATE manufacturers
      SET
        name = $1,
        contact_person = $2,
        phone = $3,
        email = $4,
        address = $5,
        country = $6,
        notes = $7,
        is_active = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING
        id,
        name,
        contact_person,
        phone,
        email,
        address,
        country,
        notes,
        is_active,
        created_at,
        updated_at
      `,
      [
        payload.name,
        payload.contact_person,
        payload.phone,
        payload.email,
        payload.address,
        payload.country,
        payload.notes,
        payload.is_active,
        req.params.id,
      ]
    );

    if (!updated.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Manufacturer not found",
      });
    }

    const manufacturer = normalizeManufacturer(updated.rows[0]);
    return res.json({
      success: true,
      data: manufacturer,
      manufacturer,
    });
  } catch (error) {
    console.error("[manufacturers] error:", error);

    if (isDuplicateNameError(error)) {
      return res.status(409).json({
        success: false,
        message: "A manufacturer with this name already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update manufacturer",
      error: error.message,
    });
  }
};

export const deleteManufacturer = async (req, res) => {
  try {
    await ensureManufacturersTable();

    const deleted = await db.query(
      `
      DELETE FROM manufacturers
      WHERE id = $1
      RETURNING id
      `,
      [req.params.id]
    );

    if (!deleted.rows[0]) {
      return res.status(404).json({
        success: false,
        message: "Manufacturer not found",
      });
    }

    return res.json({
      success: true,
      message: "Manufacturer deleted",
      id: deleted.rows[0].id,
    });
  } catch (error) {
    console.error("[manufacturers] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete manufacturer",
      error: error.message,
    });
  }
};
