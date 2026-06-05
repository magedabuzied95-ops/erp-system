import db from "../database/db.js";
import { ensureSingleBranchMode } from "./singleBranchMode.js";
import { ensureForeignKeyConstraint } from "./schemaConstraints.js";

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
    attendance_public_code VARCHAR(32) UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_qr_token TEXT;`,
  `ALTER TABLE IF EXISTS branches ADD COLUMN IF NOT EXISTS attendance_public_code VARCHAR(32);`,
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
  `
  UPDATE branches
  SET attendance_public_code = 'b' || id
  WHERE attendance_public_code IS NULL
     OR TRIM(attendance_public_code) = '';
  `,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_qr_token ON branches (attendance_qr_token);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_attendance_public_code ON branches (attendance_public_code);`,
  `
  CREATE TABLE IF NOT EXISTS employees (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    employee_code VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    photo_url TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    national_id VARCHAR(120),
    role VARCHAR(120),
    job_title VARCHAR(120),
    position VARCHAR(120),
    salary NUMERIC(12,2) NOT NULL DEFAULT 0,
    hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    manager_portal_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    user_id BIGINT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMP NULL,
    deleted_by_user_id BIGINT NULL,
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
  ALTER TABLE IF EXISTS employee_shifts
    ADD COLUMN IF NOT EXISTS check_in_window_start TIME NULL;
  `,
  `
  ALTER TABLE IF EXISTS employee_shifts
    ADD COLUMN IF NOT EXISTS check_in_window_end TIME NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS photo_url TEXT;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS manager_portal_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS user_id BIGINT NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS job_title VARCHAR(120);
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS position VARCHAR(120);
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS daily_work_hours NUMERIC(5,2) NOT NULL DEFAULT 8;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS working_days_per_month INTEGER NOT NULL DEFAULT 26;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS working_days_per_week INTEGER NOT NULL DEFAULT 6;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS work_start_time TIME NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS work_end_time TIME NULL;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS absence_deduction_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS missing_hours_deduction_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS late_deduction_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `,
  `
  ALTER TABLE IF EXISTS employees
    ADD COLUMN IF NOT EXISTS early_leave_deduction_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  `,
  `
  UPDATE employees
  SET daily_work_hours = COALESCE(NULLIF(daily_work_hours, 0), 8),
      working_days_per_month = COALESCE(NULLIF(working_days_per_month, 0), 26),
      working_days_per_week = COALESCE(NULLIF(working_days_per_week, 0), 6),
      absence_deduction_enabled = COALESCE(absence_deduction_enabled, TRUE),
      missing_hours_deduction_enabled = COALESCE(missing_hours_deduction_enabled, TRUE),
      late_deduction_enabled = COALESCE(late_deduction_enabled, TRUE),
      early_leave_deduction_enabled = COALESCE(early_leave_deduction_enabled, TRUE)
  WHERE daily_work_hours IS NULL
     OR daily_work_hours = 0
     OR working_days_per_month IS NULL
     OR working_days_per_month = 0
     OR working_days_per_week IS NULL
     OR working_days_per_week = 0
     OR absence_deduction_enabled IS NULL
     OR missing_hours_deduction_enabled IS NULL
     OR late_deduction_enabled IS NULL
     OR early_leave_deduction_enabled IS NULL;
  `,
  `
  ALTER TABLE IF EXISTS users
    ADD COLUMN IF NOT EXISTS role VARCHAR(100) DEFAULT 'user';
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
    worked_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
    work_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_leave_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    device_fingerprint TEXT,
    device_key TEXT,
    user_agent TEXT,
    ip_address TEXT,
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
    device_fingerprint TEXT,
    device_key TEXT,
    source VARCHAR(50) NOT NULL DEFAULT 'branch_qr',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS attendance_device_bindings (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    branch_id BIGINT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    business_date DATE NOT NULL,
    device_key TEXT NOT NULL,
    device_fingerprint TEXT,
    user_agent TEXT,
    ip_address TEXT,
    first_attendance_log_id BIGINT NULL REFERENCES attendance_logs(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, branch_id, business_date, device_key)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS attendance_device_settings (
    tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    new_device_policy VARCHAR(20) NOT NULL DEFAULT 'pending',
    attendance_require_device_approval BOOLEAN NOT NULL DEFAULT FALSE,
    require_device_approval BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS employee_attendance_devices (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    device_token TEXT NOT NULL,
    device_fingerprint TEXT,
    user_agent TEXT,
    ip_address TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'approved',
    first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP NULL,
    approved_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    rejected_at TIMESTAMP NULL,
    rejected_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    reset_at TIMESTAMP NULL,
    reset_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, device_token)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS attendance_suspicious_activity_logs (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NULL REFERENCES employees(id) ON DELETE SET NULL,
    branch_id BIGINT NULL REFERENCES branches(id) ON DELETE SET NULL,
    device_token TEXT,
    event_type VARCHAR(80) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    user_agent TEXT,
    ip_address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS holidays (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    holiday_date DATE NOT NULL,
    name VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS employee_leaves (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    leave_type VARCHAR(50) NOT NULL DEFAULT 'paid',
    leave_date DATE NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    notes TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS employee_vacations (
    id BIGSERIAL PRIMARY KEY,
    tenant_id BIGINT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    employee_id BIGINT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    vacation_type VARCHAR(50) NOT NULL DEFAULT 'annual',
    vacation_date DATE NULL,
    start_date DATE NULL,
    end_date DATE NULL,
    notes TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS worked_hours NUMERIC(8,2) NOT NULL DEFAULT 0;
  `,
  `
  UPDATE attendance_logs
  SET worked_hours = ROUND((COALESCE(work_minutes, 0)::numeric / 60.0), 2)
  WHERE COALESCE(worked_hours, 0) = 0
    AND COALESCE(work_minutes, 0) > 0;
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
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS device_token TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS device_id BIGINT NULL REFERENCES employee_attendance_devices(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_device_settings
    ADD COLUMN IF NOT EXISTS require_device_approval BOOLEAN NOT NULL DEFAULT FALSE;
  `,
  `
  ALTER TABLE IF EXISTS attendance_device_settings
    ADD COLUMN IF NOT EXISTS attendance_require_device_approval BOOLEAN NOT NULL DEFAULT FALSE;
  `,
  `
  ALTER TABLE IF EXISTS employee_attendance_devices
    ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
  `,
  `
  ALTER TABLE IF EXISTS employee_attendance_devices
    ADD COLUMN IF NOT EXISTS ip_address TEXT;
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
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS selected_shift_id BIGINT NULL REFERENCES employee_shifts(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS resolved_shift_start_time TIMESTAMP NULL;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS resolved_shift_end_time TIMESTAMP NULL;
  `,
  `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'attendance_logs'
        AND column_name = 'resolved_shift_start_time'
        AND data_type = 'time without time zone'
    ) THEN
      ALTER TABLE attendance_logs
        ALTER COLUMN resolved_shift_start_time TYPE TIMESTAMP
        USING (CURRENT_DATE + resolved_shift_start_time);
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'attendance_logs'
        AND column_name = 'resolved_shift_end_time'
        AND data_type = 'time without time zone'
    ) THEN
      ALTER TABLE attendance_logs
        ALTER COLUMN resolved_shift_end_time TYPE TIMESTAMP
        USING (CURRENT_DATE + resolved_shift_end_time);
    END IF;
  END $$;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS shift_resolution_status VARCHAR(40) NOT NULL DEFAULT 'unresolved';
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS device_key TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS user_agent TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_logs
    ADD COLUMN IF NOT EXISTS ip_address TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS device_fingerprint TEXT;
  `,
  `
  ALTER TABLE IF EXISTS attendance_events
    ADD COLUMN IF NOT EXISTS device_key TEXT;
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
  ALTER TABLE IF EXISTS attendance_logs
    DROP CONSTRAINT IF EXISTS attendance_logs_tenant_id_employee_id_attendance_date_key;
  `,
  `DROP INDEX IF EXISTS idx_attendance_logs_employee_date_unique;`,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_tenant_employee_branch_date_unique
    ON attendance_logs (tenant_id, employee_id, branch_id, attendance_date)
    WHERE branch_id IS NOT NULL;
  `,
  `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_logs_tenant_employee_no_branch_date_unique
    ON attendance_logs (tenant_id, employee_id, attendance_date)
    WHERE branch_id IS NULL;
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
  `CREATE INDEX IF NOT EXISTS idx_employees_tenant_active_not_deleted ON employees (tenant_id, is_deleted, status, branch_id);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_shifts_tenant_employee ON employee_shifts (tenant_id, employee_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_shifts_window_lookup ON employee_shifts (tenant_id, employee_id, check_in_window_start, check_in_window_end);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_employee_date ON attendance_logs (tenant_id, employee_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_branch_date ON attendance_logs (tenant_id, branch_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_branch_employee_date ON attendance_logs (tenant_id, employee_id, branch_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_device_key_day ON attendance_logs (tenant_id, branch_id, attendance_date, device_key) WHERE device_key IS NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_device_bindings_unique ON attendance_device_bindings (tenant_id, branch_id, business_date, device_key);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_device_bindings_employee ON attendance_device_bindings (tenant_id, branch_id, business_date, employee_id);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_logs_tenant_shift_date ON attendance_logs (tenant_id, shift_id, attendance_date DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_events_duplicate_window ON attendance_events (tenant_id, employee_id, branch_id, action_type, action_timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_events_branch_timestamp ON attendance_events (tenant_id, branch_id, action_timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_attendance_devices_employee ON employee_attendance_devices (tenant_id, employee_id, status, last_seen_at DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_attendance_devices_one_approved ON employee_attendance_devices (tenant_id, employee_id) WHERE status = 'approved';`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_suspicious_activity_logs_lookup ON attendance_suspicious_activity_logs (tenant_id, employee_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_holidays_tenant_date ON holidays (tenant_id, holiday_date);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_leaves_tenant_employee_dates ON employee_leaves (tenant_id, employee_id, start_date, end_date, leave_date, status);`,
  `CREATE INDEX IF NOT EXISTS idx_employee_vacations_tenant_employee_dates ON employee_vacations (tenant_id, employee_id, start_date, end_date, vacation_date, status);`,
  `CREATE INDEX IF NOT EXISTS idx_shift_opening_assignments_tenant_employee ON shift_opening_assignments (tenant_id, employee_id, assigned_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_shift_opening_assignments_tenant_assigned ON shift_opening_assignments (tenant_id, assigned_at DESC);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_opening_assignments_attendance_unique ON shift_opening_assignments (attendance_log_id) WHERE attendance_log_id IS NOT NULL;`,
];

const ensureAttendanceForeignKeys = async (client) => {
  await ensureForeignKeyConstraint(
    client,
    "employees",
    "employees_branch_id_fkey",
    `
    ALTER TABLE employees
    ADD CONSTRAINT employees_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID
    `
  );
  await ensureForeignKeyConstraint(
    client,
    "attendance_logs",
    "attendance_logs_branch_id_fkey",
    `
    ALTER TABLE attendance_logs
    ADD CONSTRAINT attendance_logs_branch_id_fkey
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
    NOT VALID
    `
  );
};

export const ensureAttendanceSchema = async () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        for (const statement of statements) {
          await client.query(statement);
        }
        await ensureAttendanceForeignKeys(client);
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
