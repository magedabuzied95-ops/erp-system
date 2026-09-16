// Columns + audit table for the staff password policy and MFA. Awaited from bootstrapStartup
// because runtime schema ensures are off in production. Metadata-only DDL: nullable columns,
// no defaults, no backfill - safe to run on every boot.

let ensured = null;

export const STAFF_SECURITY_USER_COLUMNS = Object.freeze([
  ["password_changed_at", "TIMESTAMPTZ"],
  ["must_change_password", "BOOLEAN"],
  ["token_version", "INTEGER"],
  ["mfa_enabled", "BOOLEAN"],
  ["mfa_secret_encrypted", "TEXT"],
  ["mfa_pending_secret_encrypted", "TEXT"],
  ["mfa_enrolled_at", "TIMESTAMPTZ"],
  ["mfa_last_used_step", "BIGINT"],
  ["mfa_recovery_codes_hash", "JSONB"],
]);

export const ensureStaffSecuritySchema = (db) => {
  if (!ensured) {
    ensured = (async () => {
      for (const [column, type] of STAFF_SECURITY_USER_COLUMNS) {
        await db.query(`ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS ${column} ${type} NULL`);
      }
      await db.query(`
        CREATE TABLE IF NOT EXISTS security_audit_events (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NULL,
          user_id BIGINT NULL,
          actor_user_id BIGINT NULL,
          event_type TEXT NOT NULL,
          outcome TEXT NOT NULL,
          ip_address TEXT NULL,
          user_agent TEXT NULL,
          details JSONB NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query(`CREATE INDEX IF NOT EXISTS security_audit_events_created_idx ON security_audit_events (created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS security_audit_events_user_idx ON security_audit_events (user_id, created_at DESC)`);
      await db.query(`CREATE INDEX IF NOT EXISTS security_audit_events_type_idx ON security_audit_events (event_type, created_at DESC)`);
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
};
