-- Development/emergency rollback only. Production rollback disables all
-- CHANNEL_GATEWAY_* flags and preserves these audit records.
DROP TABLE IF EXISTS channel_outbox_attempt_history;
DROP TABLE IF EXISTS channel_shadow_comparison_results;
DROP TABLE IF EXISTS erp_channel_outbox_events;
