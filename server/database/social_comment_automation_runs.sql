CREATE TABLE IF NOT EXISTS social_comment_automation_runs (
  id BIGSERIAL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  platform TEXT NOT NULL,
  channel TEXT NOT NULL,
  post_id TEXT NOT NULL DEFAULT '',
  post_permalink TEXT NOT NULL DEFAULT '',
  comment_id TEXT NOT NULL,
  parent_comment_id TEXT NOT NULL DEFAULT '',
  root_comment_id TEXT NOT NULL DEFAULT '',
  commenter_id TEXT NOT NULL DEFAULT '',
  commenter_name TEXT NOT NULL DEFAULT '',
  commenter_profile_picture_url TEXT NOT NULL DEFAULT '',
  original_comment_text TEXT NOT NULL DEFAULT '',
  classification_label TEXT NULL,
  classification_score NUMERIC(6,4) NULL,
  action_taken TEXT NULL,
  public_reply_status TEXT NULL,
  dm_status TEXT NULL,
  like_status TEXT NULL,
  inbox_conversation_id TEXT NULL,
  error_code TEXT NULL,
  automation_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, platform, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_created ON social_comment_automation_runs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_platform ON social_comment_automation_runs (tenant_id, platform, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_comment_automation_runs_tenant_comment ON social_comment_automation_runs (tenant_id, comment_id);
