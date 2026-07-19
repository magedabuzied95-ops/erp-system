DROP TABLE IF EXISTS channel_outbound_reconciliations;
DROP TABLE IF EXISTS channel_bridge_runtime_state;
UPDATE outbound_message_jobs SET status = 'sent' WHERE status = 'sent_unconfirmed';
ALTER TABLE outbound_message_jobs DROP CONSTRAINT IF EXISTS outbound_message_jobs_status;
ALTER TABLE outbound_message_jobs ADD CONSTRAINT outbound_message_jobs_status CHECK (status IN (
  'queued', 'processing', 'sent', 'confirmed', 'retrying', 'failed', 'cancelled', 'needs_manual_review'
));
ALTER TABLE channel_message_map
  DROP COLUMN IF EXISTS reconciliation_checked_at,
  DROP COLUMN IF EXISTS confirmation_status,
  DROP COLUMN IF EXISTS dom_fingerprint;
DROP INDEX IF EXISTS idx_channel_conversation_map_fingerprint;
ALTER TABLE channel_conversation_map DROP CONSTRAINT IF EXISTS channel_conversation_map_identity_confidence;
ALTER TABLE channel_conversation_map
  DROP COLUMN IF EXISTS last_verified_at,
  DROP COLUMN IF EXISTS identity_confidence,
  DROP COLUMN IF EXISTS conversation_fingerprint,
  DROP COLUMN IF EXISTS external_display_name,
  DROP COLUMN IF EXISTS external_username;
