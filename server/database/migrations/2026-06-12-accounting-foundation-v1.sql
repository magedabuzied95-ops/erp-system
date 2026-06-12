ALTER TABLE IF EXISTS accounts
  ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL;

ALTER TABLE IF EXISTS accounts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE IF EXISTS journal_entries
  ADD COLUMN IF NOT EXISTS branch_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_tenant_type_code
  ON accounts (tenant_id, type, code);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_entry_date
  ON journal_entries (tenant_id, entry_date DESC, id DESC);
