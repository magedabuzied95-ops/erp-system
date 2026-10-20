// Schema for the official-number account page (WhatsApp → Accounts → a number).
// One settings row per tenant + phone_number_id. `integration_id` points at
// whatsapp_cloud_integrations.id without a FK: the env-configured number has no row there.
import db from "../../../database/db.js";

let schemaPromise = null;

const run = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wa_account_settings (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL DEFAULT 0,
      phone_number_id VARCHAR(64) NOT NULL,
      integration_id BIGINT NULL,
      account_name VARCHAR(100) NOT NULL DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      team_based_distribution BOOLEAN NOT NULL DEFAULT FALSE,
      team_id INTEGER NULL,
      user_id BIGINT NULL,
      distribution_strategy VARCHAR(24) NOT NULL DEFAULT 'broadcast_all',
      admins JSONB NOT NULL DEFAULT '[]'::jsonb,
      branch_id BIGINT NULL,
      conversation_mode VARCHAR(24) NOT NULL DEFAULT 'single_thread',
      handled_by_ai BOOLEAN NOT NULL DEFAULT TRUE,
      automatic_lead BOOLEAN NOT NULL DEFAULT FALSE,
      auto_reply_active BOOLEAN NOT NULL DEFAULT FALSE,
      auto_reply_message TEXT NOT NULL DEFAULT '',
      auto_reply_start TIME NULL,
      auto_reply_end TIME NULL,
      chatbot_flow_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      chatbot_flow_id BIGINT NULL,
      session_ttl VARCHAR(16) NOT NULL DEFAULT 'run_once',
      active_during_campaign BOOLEAN NOT NULL DEFAULT FALSE,
      stickers JSONB NOT NULL DEFAULT '[]'::jsonb,
      ai_workflow_id BIGINT NULL,
      comment_workflow_id BIGINT NULL,
      followup_workflow_id BIGINT NULL,
      ai_language VARCHAR(16) NOT NULL DEFAULT '',
      image_describer BOOLEAN NOT NULL DEFAULT FALSE,
      audio_transcriber BOOLEAN NOT NULL DEFAULT FALSE,
      image_description_prompt TEXT NOT NULL DEFAULT '',
      ai_instructions TEXT NOT NULL DEFAULT '',
      send_message_ids_to_ai BOOLEAN NOT NULL DEFAULT FALSE,
      separate_bubbles BOOLEAN NOT NULL DEFAULT FALSE,
      usage_alerts BOOLEAN NOT NULL DEFAULT FALSE,
      display_name_status VARCHAR(48) NOT NULL DEFAULT '',
      new_name_status VARCHAR(48) NOT NULL DEFAULT '',
      pending_display_name TEXT NOT NULL DEFAULT '',
      verified_name TEXT NOT NULL DEFAULT '',
      display_phone_number VARCHAR(64) NOT NULL DEFAULT '',
      messaging_limit_tier VARCHAR(32) NOT NULL DEFAULT '',
      quality_rating VARCHAR(24) NOT NULL DEFAULT '',
      platform_type VARCHAR(48) NOT NULL DEFAULT '',
      code_verification_status VARCHAR(48) NOT NULL DEFAULT '',
      throughput_level VARCHAR(32) NOT NULL DEFAULT '',
      insights_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      blue_tick BOOLEAN NOT NULL DEFAULT FALSE,
      business_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      disconnect_reason TEXT NOT NULL DEFAULT '',
      disconnected_at TIMESTAMPTZ NULL,
      last_status_sync_at TIMESTAMPTZ NULL,
      last_status_error TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_wa_account_settings UNIQUE (tenant_id, phone_number_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_wa_account_settings_phone ON wa_account_settings (phone_number_id)`);
  // Away auto-reply: one row per conversation per away window, so the message goes out once.
  await db.query(`
    CREATE TABLE IF NOT EXISTS wa_auto_reply_log (
      tenant_id BIGINT NOT NULL DEFAULT 0,
      phone_number_id VARCHAR(64) NOT NULL,
      conversation_id VARCHAR(191) NOT NULL,
      window_key VARCHAR(16) NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, phone_number_id, conversation_id, window_key)
    )
  `);
};

export const ensureWaAccountSettingsSchema = () => {
  if (!schemaPromise) {
    schemaPromise = run().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
};
