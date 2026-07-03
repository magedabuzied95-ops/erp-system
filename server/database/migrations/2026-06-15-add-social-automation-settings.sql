CREATE TABLE IF NOT EXISTS social_automation_settings (
  tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
  public_reply_template TEXT NOT NULL DEFAULT 'أهلاً وسهلاً يا {{customer_name}} ❤️ تم الرد في الخاص يا صديقي  وعندنا شحن لجميع محافظات مصر  ━━━━━━━━━━━━━━━━━━  العنوان: دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️   اللوكيشن: https://share.google/1e0cM7JVmxyLTpWVe',
  private_message_template TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE IF EXISTS social_automation_settings
  ADD COLUMN IF NOT EXISTS tenant_id BIGINT,
  ADD COLUMN IF NOT EXISTS auto_like_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_public_reply_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_private_message_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS min_confidence NUMERIC(6,4) NOT NULL DEFAULT 0.9000,
  ADD COLUMN IF NOT EXISTS public_reply_template TEXT NOT NULL DEFAULT 'أهلاً وسهلاً يا {{customer_name}} ❤️ تم الرد في الخاص يا صديقي  وعندنا شحن لجميع محافظات مصر  ━━━━━━━━━━━━━━━━━━  العنوان: دمياط الجديدة - شارع البشبيشي - بجوار الفرنسية جروب ❤️   اللوكيشن: https://share.google/1e0cM7JVmxyLTpWVe',
  ADD COLUMN IF NOT EXISTS private_message_template TEXT NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;