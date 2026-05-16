import db from "../database/db.js";
import { ensureSingleBranchMode } from "./singleBranchMode.js";

let schemaReadyPromise = null;

const statements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto;`,
  `
  CREATE TABLE IF NOT EXISTS tenants (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(120) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    plan VARCHAR(50) NOT NULL DEFAULT 'trial',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  INSERT INTO tenants (id, name, slug, status, plan)
  VALUES (1, 'ERP Platform', 'platform', 'active', 'enterprise')
  ON CONFLICT (id) DO NOTHING;
  `,
  `
  CREATE TABLE IF NOT EXISTS branches (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50),
    phone VARCHAR(50),
    address TEXT,
    manager VARCHAR(255),
    default_warehouse_id BIGINT NULL REFERENCES warehouses(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    latitude NUMERIC,
    longitude NUMERIC,
    attendance_radius_meters INTEGER NOT NULL DEFAULT 100,
    allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
    qr_token TEXT UNIQUE DEFAULT gen_random_uuid()::text,
    attendance_qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_qr_token TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS latitude NUMERIC;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS longitude NUMERIC;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_radius_meters INTEGER NOT NULL DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER NOT NULL DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN attendance_radius_meters SET DEFAULT 100;`,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN allowed_radius_meters SET DEFAULT 100;`,
  `
  UPDATE branches
  SET attendance_radius_meters = COALESCE(attendance_radius_meters, allowed_radius_meters, 100),
      allowed_radius_meters = COALESCE(allowed_radius_meters, attendance_radius_meters, 100)
  WHERE attendance_radius_meters IS NULL
     OR allowed_radius_meters IS NULL;
  `,
  `ALTER TABLE IF EXISTS branches ALTER COLUMN attendance_qr_token SET DEFAULT encode(gen_random_bytes(32), 'hex');`,
  `
  UPDATE branches
  SET attendance_qr_token = COALESCE(attendance_qr_token, encode(gen_random_bytes(32), 'hex'))
  WHERE attendance_qr_token IS NULL;
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_qr_token ON branches (attendance_qr_token);`,
  `
  CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    employee_code VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255),
    national_id VARCHAR(120),
    role VARCHAR(120),
    salary NUMERIC(12,2) NOT NULL DEFAULT 0,
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, employee_code)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS employee_shifts (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_name VARCHAR(255) NOT NULL,
    shift_type VARCHAR(50) NOT NULL DEFAULT 'regular',
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    expected_hours NUMERIC(5,2) NOT NULL DEFAULT 10,
    allowed_late_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_after_minutes INTEGER NOT NULL DEFAULT 0,
    working_days JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS employee_shifts
    ADD COLUMN IF NOT EXISTS shift_type VARCHAR(50) NOT NULL DEFAULT 'regular';
  `,
  `
  ALTER TABLE IF EXISTS employee_shifts
    ADD COLUMN IF NOT EXISTS expected_hours NUMERIC(5,2) NOT NULL DEFAULT 10;
  `,
  `
  UPDATE employee_shifts
  SET
    shift_type = CASE
      WHEN LOWER(COALESCE(shift_name, '')) LIKE '%open%' THEN 'opening'
      ELSE COALESCE(NULLIF(shift_type, ''), 'regular')
    END,
    expected_hours = COALESCE(expected_hours, 10)
  WHERE shift_type IS NULL
    OR shift_type = ''
    OR expected_hours IS NULL;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ADD COLUMN IF NOT EXISTS latitude NUMERIC;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ADD COLUMN IF NOT EXISTS longitude NUMERIC;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER NOT NULL DEFAULT 100;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ADD COLUMN IF NOT EXISTS qr_token TEXT;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ALTER COLUMN allowed_radius_meters SET DEFAULT 100;
  `,
  `
  ALTER TABLE IF EXISTS warehouses
    ALTER COLUMN qr_token SET DEFAULT gen_random_uuid()::text;
  `,
  `
  UPDATE warehouses
  SET qr_token = COALESCE(qr_token, gen_random_uuid()::text)
  WHERE qr_token IS NULL;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_qr_token ON warehouses (qr_token);
  `,
  `
  CREATE TABLE IF NOT EXISTS attendance_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    shift_id BIGINT NULL REFERENCES employee_shifts(id) ON DELETE SET NULL,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    attendance_date DATE NOT NULL,
    check_in TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_out TIMESTAMP NULL,
    check_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    check_out_at TIMESTAMP NULL,
    check_in_latitude NUMERIC NULL,
    check_in_longitude NUMERIC NULL,
    check_in_gps_distance_meters NUMERIC NULL,
    check_in_gps_verification_result VARCHAR(30),
    check_out_latitude NUMERIC NULL,
    check_out_longitude NUMERIC NULL,
    check_out_gps_distance_meters NUMERIC NULL,
    check_out_gps_verification_result VARCHAR(30),
    attendance_source VARCHAR(50) NOT NULL DEFAULT 'manual',
    status VARCHAR(30) NOT NULL DEFAULT 'checked_in',
    work_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_leave_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, employee_id, attendance_date)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS attendance_events (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL,
    action_type VARCHAR(30) NOT NULL,
    action_timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    latitude NUMERIC NULL,
    longitude NUMERIC NULL,
    gps_distance_meters NUMERIC NULL,
    gps_verification_result VARCHAR(30),
    source VARCHAR(50) NOT NULL DEFAULT 'branch_qr',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_out_at TIMESTAMP NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_in_latitude NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_in_longitude NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_in_gps_distance_meters NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_in_gps_verification_result VARCHAR(30);
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_out_latitude NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_out_longitude NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_out_gps_distance_meters NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS check_out_gps_verification_result VARCHAR(30);
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'checked_in';
  `,
  `
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS gps_distance_meters NUMERIC NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS gps_verification_result VARCHAR(30);
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS next_opening_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS closed_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL;
  `,
  `
  ALTER TABLE IF EXISTS cashbox
    ADD COLUMN IF NOT EXISTS next_opening_employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS cashbox
    ADD COLUMN IF NOT EXISTS closed_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS cashbox
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP NULL;
  `,
  `
  CREATE TABLE IF NOT EXISTS shift_opening_assignments (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shift_id BIGINT NULL,
    attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    assigned_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_employee_date_unique
    ON attendance_logs (employee_id, attendance_date);
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT 'cash';
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS cash_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS card_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `,
  `
  ALTER TABLE IF EXISTS orders
    ADD COLUMN IF NOT EXISTS wallet_payment_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
  `,
  `CREATE INDEX IF NOT EXISTS idx_employees_tenant_branch ON employees (tenant_id, branch_id);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_shifts_tenant_employee ON employee_shifts (tenant_id, employee_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_employee_date ON attendance_logs (tenant_id, employee_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_branch_date ON attendance_logs (tenant_id, branch_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_shift_date ON attendance_logs (tenant_id, shift_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_events_duplicate_window ON attendance_events (tenant_id, employee_id, branch_id, action_type, action_timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_events_branch_timestamp ON attendance_events (tenant_id, branch_id, action_timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_shift_opening_assignments_tenant_employee ON shift_opening_assignments (tenant_id, employee_id, assigned_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_shift_opening_assignments_tenant_assigned ON shift_opening_assignments (tenant_id, assigned_at DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_opening_assignments_attendance_unique ON shift_opening_assignments (attendance_log_id) WHERE attendance_log_id IS NOT NULL;`,
  `ALTER TABLE IF EXISTS employees DROP CONSTRAINT IF EXISTS employees_branch_id_fkey;`,
  `
  ALTER TABLE IF EXISTS employees
    ADD CONSTRAINT employees_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID;
  `,
  `ALTER TABLE IF EXISTS attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_branch_id_fkey;`,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD CONSTRAINT attendance_logs_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID;
  `,
];

export const ensureAttendanceSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          await client.query(statement);
        }
        await ensureSingleBranchMode(client);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
};

export default ensureAttendanceSchema;
