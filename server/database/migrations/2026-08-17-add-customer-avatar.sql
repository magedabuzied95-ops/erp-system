-- Customer profile pictures (WhatsApp first).
-- Additive only: no existing table, column, index, or data is removed or rewritten.
-- The same columns are ensured at runtime by ensureCustomerSchema() and by
-- ensureWhatsappCustomerAvatarSchema(), so this file is the record, not the gate.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_source VARCHAR(40);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS avatar_updated_at TIMESTAMP NULL;
