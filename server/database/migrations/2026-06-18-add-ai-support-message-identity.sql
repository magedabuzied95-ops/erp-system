ALTER TABLE IF EXISTS ai_support_messages
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS message_identity_key TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_support_messages
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_support_sessions
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS ai_channel_conversations
  ADD COLUMN IF NOT EXISTS client_request_id TEXT NOT NULL DEFAULT '';

UPDATE ai_support_sessions
SET session_id = CASE
  WHEN NULLIF(regexp_replace(regexp_replace(lower(session_id), '^whatsapp:', ''), '\D', '', 'g'), '') IS NOT NULL
    THEN 'whatsapp:' || NULLIF(regexp_replace(regexp_replace(lower(session_id), '^whatsapp:', ''), '\D', '', 'g'), '')
  ELSE session_id
END
WHERE lower(channel) = 'whatsapp'
  AND COALESCE(session_id, '') <> ''
  AND session_id !~ '^whatsapp:[0-9]+$';

UPDATE ai_channel_conversations
SET external_conversation_id = CASE
  WHEN NULLIF(regexp_replace(regexp_replace(lower(external_conversation_id), '^whatsapp:', ''), '\D', '', 'g'), '') IS NOT NULL
    THEN 'whatsapp:' || NULLIF(regexp_replace(regexp_replace(lower(external_conversation_id), '^whatsapp:', ''), '\D', '', 'g'), '')
  ELSE external_conversation_id
END
WHERE lower(channel) = 'whatsapp'
  AND COALESCE(external_conversation_id, '') <> ''
  AND external_conversation_id !~ '^whatsapp:[0-9]+$';

UPDATE ai_support_messages
SET
  session_id = CASE
    WHEN lower(channel) = 'whatsapp' AND COALESCE(session_id, '') <> '' AND session_id !~ '^whatsapp:[0-9]+$'
      THEN COALESCE('whatsapp:' || NULLIF(regexp_replace(regexp_replace(lower(session_id), '^whatsapp:', ''), '\D', '', 'g'), ''), session_id)
    ELSE session_id
  END,
  remote_jid = CASE
    WHEN lower(channel) = 'whatsapp' AND COALESCE(remote_jid, '') <> '' AND remote_jid !~ '^whatsapp:[0-9]+$'
      THEN COALESCE('whatsapp:' || NULLIF(regexp_replace(regexp_replace(lower(remote_jid), '^whatsapp:', ''), '\D', '', 'g'), ''), remote_jid)
    ELSE remote_jid
  END,
  resolved_reply_jid = CASE
    WHEN lower(channel) = 'whatsapp' AND COALESCE(resolved_reply_jid, '') <> '' AND resolved_reply_jid !~ '^whatsapp:[0-9]+$'
      THEN COALESCE('whatsapp:' || NULLIF(regexp_replace(regexp_replace(lower(resolved_reply_jid), '^whatsapp:', ''), '\D', '', 'g'), ''), resolved_reply_jid)
    ELSE resolved_reply_jid
  END,
  resolved_phone = CASE
    WHEN lower(channel) = 'whatsapp' AND COALESCE(resolved_phone, '') <> ''
      THEN NULLIF(regexp_replace(resolved_phone, '\D', '', 'g'), '')
    ELSE resolved_phone
  END
WHERE lower(channel) = 'whatsapp';

UPDATE ai_support_messages
SET client_request_id = COALESCE(NULLIF(client_request_id, ''), NULLIF(external_reply_id, ''), '')
WHERE COALESCE(NULLIF(client_request_id, ''), '') = '' AND COALESCE(NULLIF(external_reply_id, ''), '') <> '';

UPDATE ai_support_messages
SET message_identity_key = CASE
  WHEN COALESCE(NULLIF(message_identity_key, ''), '') <> '' THEN message_identity_key
  WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || client_request_id
  WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || provider_message_id
  WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN 'msg:' || tenant_id::text || '|' || session_id || '|' || COALESCE(NULLIF(sender_type, ''), 'outbound') || '|' || external_message_id
  ELSE ''
END,
idempotency_key = CASE
  WHEN COALESCE(NULLIF(idempotency_key, ''), '') <> '' THEN idempotency_key
  WHEN COALESCE(NULLIF(client_request_id, ''), '') <> '' THEN client_request_id
  WHEN COALESCE(NULLIF(provider_message_id, ''), '') <> '' THEN provider_message_id
  WHEN COALESCE(NULLIF(external_message_id, ''), '') <> '' THEN external_message_id
  ELSE ''
END;

DELETE FROM ai_support_messages newer
USING ai_support_messages older
WHERE newer.id > older.id
  AND newer.tenant_id = older.tenant_id
  AND newer.session_id = older.session_id
  AND newer.message_identity_key <> ''
  AND newer.message_identity_key = older.message_identity_key;

DELETE FROM ai_support_messages newer
USING ai_support_messages older
WHERE newer.id > older.id
  AND newer.tenant_id = older.tenant_id
  AND newer.session_id = older.session_id
  AND newer.provider_message_id <> ''
  AND newer.provider_message_id = older.provider_message_id;

DELETE FROM ai_support_messages newer
USING ai_support_messages older
WHERE newer.id > older.id
  AND newer.tenant_id = older.tenant_id
  AND newer.session_id = older.session_id
  AND newer.external_message_id <> ''
  AND newer.external_message_id = older.external_message_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_provider_message_id_session
  ON ai_support_messages (tenant_id, session_id, provider_message_id)
  WHERE provider_message_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_external_message_id_session
  ON ai_support_messages (tenant_id, session_id, external_message_id)
  WHERE external_message_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_support_messages_identity_key
  ON ai_support_messages (tenant_id, session_id, message_identity_key)
  WHERE message_identity_key <> '';
