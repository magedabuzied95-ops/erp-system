-- Development/emergency rollback only. Normal production rollback disables the
-- Gateway feature and preserves these tables so no accepted message is lost.
DROP TABLE IF EXISTS channel_gateway_request_nonces;
DROP TABLE IF EXISTS channel_gateway_outbox_events;
DROP TABLE IF EXISTS bridge_events;
DROP TABLE IF EXISTS channel_queue_lanes;
DROP TABLE IF EXISTS outbound_message_jobs;
DROP TABLE IF EXISTS channel_inbound_events;
DROP TABLE IF EXISTS channel_message_map;
DROP TABLE IF EXISTS channel_conversation_map;
DROP TABLE IF EXISTS channel_connections;
