import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import db from "../database/db.js";

/*
 * The employee PIN ("الرقم السري للموظف").
 *
 * ERP accounts are shared on the shop floor, so `req.user` answers "which
 * login saved this", never "which person typed it". The PIN closes that gap:
 * the employee sets it themselves from their own portal link (nobody else ever
 * sees it — only a bcrypt hash is stored), and product entry asks for the
 * employee plus their PIN before the product is saved. That is what the
 * product lifecycle dialog then shows as "اتضاف للسيستم بواسطة ...".
 *
 * Verification hands back a short-lived signed token instead of keeping the PIN
 * in the page: the Add Product form can be filled for an hour without the PIN
 * living in React state, and the save re-verifies the signature server side.
 * The token carries `type`, so `isStaffSessionToken` can never mistake it for
 * a session (see server/middleware/authMiddleware.js).
 */

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 8;
const PIN_TOKEN_TTL_SECONDS = 60 * 60 * 6;
const PIN_TOKEN_TYPE = "product_entry_employee";
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const ARABIC_DIGIT_MAP = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const failedAttempts = new Map(); // `${tenantId}:${employeeId}` -> { count, firstAt }

let schemaReady = false;

const fail = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

export const ensureEmployeeStaffPinSchema = async (clientOrPool = db) => {
  if (schemaReady && clientOrPool === db) return;
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS staff_pin_hash TEXT`);
  await clientOrPool.query(`ALTER TABLE IF EXISTS employees ADD COLUMN IF NOT EXISTS staff_pin_set_at TIMESTAMPTZ NULL`);
  if (clientOrPool === db) schemaReady = true;
};

export const normalizeStaffPin = (value) =>
  String(value ?? "")
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGIT_MAP[digit] || digit)
    .replace(/\D/g, "");

// A PIN that is 1111 or 1234 protects nobody: the whole point is that a
// colleague cannot enter a product under someone else's name.
const assertPinStrength = (pin) => {
  if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
    throw fail(400, "staff_pin_length", `الرقم السري لازم يكون من ${PIN_MIN_LENGTH} لـ ${PIN_MAX_LENGTH} أرقام`);
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw fail(400, "staff_pin_weak", "اختر رقم سري أصعب، مش كله نفس الرقم");
  }
  const ascending = "0123456789";
  const descending = "9876543210";
  if (ascending.includes(pin) || descending.includes(pin)) {
    throw fail(400, "staff_pin_weak", "اختر رقم سري أصعب، مش أرقام متتالية");
  }
};

const attemptKey = (tenantId, employeeId) => `${tenantId ?? "null"}:${employeeId}`;

const readAttempts = (key) => {
  const entry = failedAttempts.get(key);
  if (!entry) return null;
  if (Date.now() - entry.firstAt > ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(key);
    return null;
  }
  return entry;
};

const registerFailedAttempt = (key) => {
  const entry = readAttempts(key);
  if (!entry) {
    failedAttempts.set(key, { count: 1, firstAt: Date.now() });
    return;
  }
  entry.count += 1;
};

const loadEmployeeForPin = async ({ employeeId, tenantId = null, clientOrPool = db }) => {
  const result = await clientOrPool.query(
    `
    SELECT id, tenant_id, full_name, employee_code, status, staff_pin_hash, staff_pin_set_at
    FROM employees
    WHERE id = $1::bigint
      AND ($2::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $2::bigint)
    LIMIT 1
    `,
    [employeeId, tenantId]
  );
  return result.rows[0] || null;
};

export const setEmployeeStaffPin = async ({ employeeId, tenantId = null, pin, currentPin = "", clientOrPool = db }) => {
  await ensureEmployeeStaffPinSchema(clientOrPool);
  const nextPin = normalizeStaffPin(pin);
  assertPinStrength(nextPin);

  const employee = await loadEmployeeForPin({ employeeId, tenantId, clientOrPool });
  if (!employee) throw fail(404, "employee_not_found", "الموظف غير موجود");

  // Changing an existing PIN needs the old one: the portal link may be open on a
  // phone somebody else picked up.
  if (employee.staff_pin_hash) {
    const previous = normalizeStaffPin(currentPin);
    if (!previous) throw fail(400, "staff_pin_current_required", "اكتب الرقم السري الحالي عشان تغيّره");
    const matches = await bcrypt.compare(previous, employee.staff_pin_hash);
    if (!matches) throw fail(401, "staff_pin_current_invalid", "الرقم السري الحالي غلط");
  }

  const hash = await bcrypt.hash(nextPin, 10);
  await clientOrPool.query(
    `UPDATE employees SET staff_pin_hash = $1, staff_pin_set_at = NOW(), updated_at = NOW() WHERE id = $2::bigint`,
    [hash, employee.id]
  );
  failedAttempts.delete(attemptKey(employee.tenant_id, employee.id));
  return { id: Number(employee.id), name: employee.full_name || "", set_at: new Date().toISOString() };
};

export const verifyEmployeeStaffPin = async ({ employeeId, tenantId = null, pin, clientOrPool = db }) => {
  await ensureEmployeeStaffPinSchema(clientOrPool);
  const id = Number(employeeId);
  if (!Number.isFinite(id) || id <= 0) throw fail(400, "entry_employee_required", "اختر الموظف اللي بيدخل المنتج");

  const key = attemptKey(tenantId, id);
  const attempts = readAttempts(key);
  if (attempts && attempts.count >= MAX_FAILED_ATTEMPTS) {
    throw fail(429, "staff_pin_locked", "محاولات كتير غلط، استنى شوية وجرّب تاني");
  }

  const employee = await loadEmployeeForPin({ employeeId: id, tenantId, clientOrPool });
  if (!employee) throw fail(404, "employee_not_found", "الموظف غير موجود");
  if (String(employee.status || "active").toLowerCase() !== "active") {
    throw fail(403, "employee_inactive", "الموظف ده مش على رأس العمل");
  }
  if (!employee.staff_pin_hash) {
    throw fail(400, "staff_pin_missing", "الموظف ده لسه ماعملش رقم سري من بوابة الموظف");
  }

  const candidate = normalizeStaffPin(pin);
  const matches = candidate ? await bcrypt.compare(candidate, employee.staff_pin_hash) : false;
  if (!matches) {
    registerFailedAttempt(key);
    throw fail(401, "staff_pin_invalid", "الرقم السري غلط");
  }

  failedAttempts.delete(key);
  return {
    id: Number(employee.id),
    tenant_id: employee.tenant_id === null || employee.tenant_id === undefined ? null : Number(employee.tenant_id),
    name: employee.full_name || "",
    employee_code: employee.employee_code || "",
  };
};

export const issueProductEntryToken = (employee) =>
  jwt.sign(
    {
      type: PIN_TOKEN_TYPE,
      employee_id: Number(employee.id),
      tenant_id: employee.tenant_id ?? null,
      name: employee.name || "",
    },
    process.env.JWT_SECRET || "SECRET_KEY",
    { expiresIn: PIN_TOKEN_TTL_SECONDS }
  );

export const verifyProductEntryToken = (token) => {
  if (!token) return null;
  try {
    const decoded = jwt.verify(String(token), process.env.JWT_SECRET || "SECRET_KEY");
    if (!decoded || decoded.type !== PIN_TOKEN_TYPE) return null;
    const employeeId = Number(decoded.employee_id);
    if (!Number.isFinite(employeeId) || employeeId <= 0) return null;
    return {
      id: employeeId,
      tenant_id: decoded.tenant_id ?? null,
      name: decoded.name || "",
    };
  } catch {
    return null;
  }
};

/*
 * Whether the PIN gate can be enforced at all yet. Before anyone has set a PIN
 * the requirement would simply lock the shop out of adding products, so it
 * switches itself on with the first PIN.
 */
export const hasAnyStaffPin = async ({ tenantId = null, clientOrPool = db } = {}) => {
  await ensureEmployeeStaffPinSchema(clientOrPool);
  const result = await clientOrPool.query(
    `SELECT EXISTS (
       SELECT 1 FROM employees
       WHERE staff_pin_hash IS NOT NULL
         AND ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
     ) AS present`,
    [tenantId]
  );
  return result.rows[0]?.present === true;
};

export const listProductEntryEmployees = async ({ tenantId = null, clientOrPool = db } = {}) => {
  await ensureEmployeeStaffPinSchema(clientOrPool);
  const result = await clientOrPool.query(
    `
    SELECT id, full_name, employee_code, job_title, staff_pin_hash IS NOT NULL AS has_pin
    FROM employees
    WHERE ($1::bigint IS NULL OR tenant_id IS NULL OR tenant_id = $1::bigint)
      AND LOWER(COALESCE(status, 'active')) = 'active'
    ORDER BY (staff_pin_hash IS NULL), full_name ASC
    `,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.full_name || "",
    employee_code: row.employee_code || "",
    job_title: row.job_title || "",
    has_pin: row.has_pin === true,
  }));
};

/*
 * One resolver for every write that wants to stamp a real person on a record.
 * A token is the normal path (the form verified the PIN before the save); the
 * raw employee id + PIN is accepted too so an API caller — or a save whose
 * token expired mid-form — still works without a second round trip.
 */
export const resolveProductEntryEmployee = async ({
  tenantId = null,
  token = "",
  employeeId = null,
  pin = "",
  clientOrPool = db,
} = {}) => {
  const fromToken = verifyProductEntryToken(token);
  if (fromToken) {
    if (employeeId && Number(employeeId) !== fromToken.id) {
      throw fail(400, "entry_employee_mismatch", "تأكيد الموظف مش مطابق للموظف المختار");
    }
    const employee = await loadEmployeeForPin({ employeeId: fromToken.id, tenantId, clientOrPool });
    if (!employee) throw fail(404, "employee_not_found", "الموظف غير موجود");
    return {
      id: Number(employee.id),
      name: employee.full_name || fromToken.name || "",
      employee_code: employee.employee_code || "",
    };
  }
  if (normalizeStaffPin(pin)) {
    const verified = await verifyEmployeeStaffPin({ employeeId, tenantId, pin, clientOrPool });
    return { id: verified.id, name: verified.name, employee_code: verified.employee_code };
  }
  return null;
};

export const __staffPinInternals = { assertPinStrength, failedAttempts, PIN_TOKEN_TYPE };
